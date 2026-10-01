import http from "node:http";
import dotenv from "dotenv";
dotenv.config();
import ngrok from "@ngrok/ngrok";
import { logger } from "./src/utils/logger";
import fs from "fs";
import { v4 } from "uuid";

interface TunnelEnv {
  NODE_ENV: string;
  ILP_ADDRESS: string;
  CLOUD_NINE_PUBLIC_HOST: string;
  CLOUD_NINE_OPEN_PAYMENTS_URL: string;
  CLOUD_NINE_WALLET_ADDRESS_URL: string;
  CLOUD_NINE_AUTH_SERVER_DOMAIN: string;
  CLOUD_NINE_CONNECTOR_URL: string;
}

interface Tunnel {
  name: string;
  url: string | null;
  targetPort: number;
  proxyPort: number;
  domain: string | undefined;
}

let envs: TunnelEnv;

const envFile = ".env.tunnel";

function checkExistingEnvFile() {
  console.log(fs.existsSync(envFile));
  if (fs.existsSync(envFile)) {
    console.log("file exists", envFile);
    // remove the existing .env file
    // the docker containers will start after .env file is recreated
    fs.unlinkSync(envFile);
  }
}

const getEnvs = (opUrl: string, authUrl: string, connectorUrl: string) => {
  return {
    NODE_ENV: "development",
    ILP_ADDRESS: process.env.ILP_ADDRESS || `test.local-playground-${v4()}`,
    CLOUD_NINE_PUBLIC_HOST: opUrl,
    CLOUD_NINE_OPEN_PAYMENTS_URL: opUrl,
    CLOUD_NINE_WALLET_ADDRESS_URL: `${opUrl}/.well-known/pay`,
    CLOUD_NINE_AUTH_SERVER_DOMAIN: authUrl,
    CLOUD_NINE_CONNECTOR_URL: connectorUrl,
  };
};

async function writeEnvs(envs: TunnelEnv) {
  fs.writeFileSync(
    `${envFile}`,
    Object.entries(envs)
      .map((entry) => entry.join("="))
      .join("\n"),
  );
}

// Service definitions — each gets its own tunnel
const tunnels: Tunnel[] = [
  {
    name: "openpayments",
    targetPort: 3000,
    proxyPort: 3005,
    domain: process.env.NGROK_DOMAIN, // your reserved domain
    url: "",
  },
  {
    name: "auth",
    targetPort: 3006,
    proxyPort: 3007,
    domain: process.env.NGROK_AUTH_DOMAIN, // optional: reserved domain for auth
    url: "",
  },
  {
    name: "connector",
    targetPort: 3002,
    proxyPort: 3008,
    domain: process.env.NGROK_CONNECTOR_DOMAIN, // optional: reserved domain for connector
    url: "",
  },
];

// Create a logging reverse proxy for a given target port
const createProxy = (name: string, targetPort: number, proxyPort: number) => {
  const server = http.createServer((req, res) => {
    const start = Date.now();
    const pathname = (req.url ?? "/").split(/[?#]/, 1)[0];
    logger.info(`--> [${name}] ${req.method} ${pathname}`);

    const forwardReq = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (targetRes) => {
        const duration = Date.now() - start;
        logger.info(
          `<-- [${name}] ${req.method} ${pathname} ${targetRes.statusCode} (${duration}ms)`,
        );
        res.writeHead(targetRes.statusCode || 500, targetRes.headers);
        targetRes.pipe(res);
      },
    );

    forwardReq.on("error", (err) => {
      logger.error(
        { event: "proxy_forward_failed", pathname, code: (err as NodeJS.ErrnoException).code },
        `[${name}] Failed to forward to port ${targetPort}`,
      );
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway" }));
    });

    req.pipe(forwardReq);
  });

  return new Promise<http.Server>((resolve) => {
    server.listen(proxyPort, () => resolve(server));
  });
};

// Start all tunnels
const servers: http.Server[] = [];

async function startAllTunnels() {
  logger.info(`Starting all tunnels and preparing .env file...`);

  checkExistingEnvFile();

  for (let index = 0; index < tunnels.length; index++) {
    const tunnel = tunnels[index];
    const server = await createProxy(
      tunnel.name,
      tunnel.targetPort,
      tunnel.proxyPort,
    );
    servers.push(server);

    const listener = await ngrok.forward({
      addr: tunnel.proxyPort,
      authtoken_from_env: true,
      ...(tunnel.domain && { domain: tunnel.domain }),
      onStatusChange: (status) => {
        logger.info(`[ngrok:${tunnel.name}] Status: ${status}`);
      },
    });

    tunnels[index].url = listener.url();
    logger.info(
      `[${tunnel.name}] Ingress at ${listener.url()} -> :${tunnel.targetPort}`,
    );
  }
}

const connect = async () => {
  await startAllTunnels().then(async () => {
    let urls: Record<string, Tunnel> = {};

    for (let i = 0; i < tunnels.length; i++) {
      const tunnel = tunnels[i];
      urls[tunnel.name] = tunnel;
    }

    const openpaymentsUrl = urls["openpayments"].url || "";
    const authUrl = urls["auth"].url || "";
    const connectorUrl = urls["connector"].url || "";

    envs = getEnvs(openpaymentsUrl, authUrl, connectorUrl);
    await writeEnvs(envs);
  });
};

connect();

// Graceful shutdown
const handleShutdown = async () => {
  logger.info("Closing all proxies and ngrok tunnels...");
  servers.forEach((s) => s.close());
  await ngrok.disconnect();
  await ngrok.kill();
  process.exit(0);
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

import type { GrantScope } from "@/types/grant";

export const getWalletGrantScope = (walletAddressUrl: string): GrantScope => [
  { type: "incoming-payment", actions: ["create", "read", "list"] },
  { type: "quote", actions: ["create", "read"] },
  { type: "outgoing-payment", actions: ["create", "read", "list"], identifier: walletAddressUrl },
];

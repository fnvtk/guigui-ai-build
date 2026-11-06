/** Public billing catalog and checkout response shapes. These types never carry provider credentials. */
export interface GuaiBillingPlan {
  skuId: string;
  name: string;
  description?: string;
  /** Display values must come from trusted provider catalog data or host configuration. */
  displayPrice?: string;
  availability?: "available" | "reference_only";
  checkoutEnabled?: boolean;
  priceVersionId?: string;
  currency?: string;
  amountMinor?: number;
  includedCredits?: number;
  kind?: string;
  referenceOnly?: boolean;
}

export interface GuaiBillingCatalog {
  configured: boolean;
  catalogConnected: boolean;
  checkoutReady: boolean;
  paymentChannelsLiveVerified?: boolean;
  catalogStatus?: "connected" | "not_configured" | "reference_only";
  referenceSource?: { file: string; url: string; checkedAt: string; scope: string };
  message?: string;
  plans: GuaiBillingPlan[];
}

export interface GuaiBillingBalance {
  availableCredits: number;
  reservedCredits: number;
}

export type GuaiCheckoutStatus = "created" | "pending" | "paid" | "failed" | "expired" | "unknown";

export interface GuaiCheckoutOrder {
  orderId: string;
  skuId: string;
  status: GuaiCheckoutStatus;
  fulfillmentStatus?: "pending" | "fulfilled";
  checkoutUrl?: string;
  message?: string;
}

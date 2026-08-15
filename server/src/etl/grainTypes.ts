// Shapes a connector's product-level / ad-level normalize() methods return,
// shared by both Google and Meta connectors and by productAdGrains.ts's
// upsert functions. Kept in a leaf module (no imports from ../connectors/*)
// so connectors and the ETL upsert layer can both depend on it without a
// circular import.

export interface ProductPerformanceInput {
  campaignId: string;
  campaignName: string | null;
  productItemId: string;
  productTitle: string | null;
  productBrand: string | null;
  /** Google Shopping category taxonomy. Null on Meta -- its product_id
   * breakdown has no category dimension (would need a separate Product
   * Catalog API call to enrich, not built). */
  productTypeL1: string | null;
  productTypeL2: string | null;
  productTypeL3: string | null;
  productChannel: string | null;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  raw: Record<string, unknown>;
}

export interface AdPerformanceInput {
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  adId: string;
  adName: string | null;
  adType: string | null;
  adStatus: string | null;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  raw: Record<string, unknown>;
}

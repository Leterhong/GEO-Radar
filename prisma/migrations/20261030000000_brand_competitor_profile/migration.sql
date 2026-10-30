-- Brand / competitor profile and monitoring status
ALTER TABLE "Brand" ADD COLUMN "englishName" TEXT;

ALTER TABLE "Competitor" ADD COLUMN "industry" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "products" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Competitor" ADD COLUMN "productAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Competitor" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

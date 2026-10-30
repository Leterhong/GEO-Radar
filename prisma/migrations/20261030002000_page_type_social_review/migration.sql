-- Additional page types for review and social sources
ALTER TYPE "PageType" ADD VALUE IF NOT EXISTS 'REVIEW_PAGE';
ALTER TYPE "PageType" ADD VALUE IF NOT EXISTS 'SOCIAL_MEDIA';

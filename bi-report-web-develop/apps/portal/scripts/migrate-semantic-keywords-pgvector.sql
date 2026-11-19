-- New objects for the SemantIQ keyword vectors, in database bi_semantiq (pgvector 0.8.1).
-- Created alongside, not instead of, public.bi_portal_semantic_embeddings (vector(1536), left untouched).
-- Idempotent: safe to run more than once.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.semantic_keyword_embeddings (
  id            uuid PRIMARY KEY,                 -- same uuid5 point id used in Qdrant (stable per keyword)
  object_kind   text NOT NULL,                    -- 'measure' | 'column' | 'value' | ...
  keyword       text NOT NULL,
  measure_name  text,
  table_name    text,
  dataset_id    text NOT NULL,                    -- semantic model (dataset) id, lower-cased
  workspace_id  text,
  report_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  description   text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding     vector(384) NOT NULL,             -- fastembed bge-small-en-v1.5 (384 dims, cosine)
  source        text NOT NULL DEFAULT 'qdrant-migration',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Vector search (cosine), same metric the Qdrant collection used.
CREATE INDEX IF NOT EXISTS semantic_keyword_embeddings_hnsw_idx
  ON public.semantic_keyword_embeddings USING hnsw (embedding vector_cosine_ops);

-- Filters the router uses: one semantic model, optionally one object kind.
CREATE INDEX IF NOT EXISTS semantic_keyword_embeddings_dataset_kind_idx
  ON public.semantic_keyword_embeddings (dataset_id, object_kind);

-- Exact keyword lookups (value and synonym matching).
CREATE INDEX IF NOT EXISTS semantic_keyword_embeddings_keyword_idx
  ON public.semantic_keyword_embeddings (lower(keyword));

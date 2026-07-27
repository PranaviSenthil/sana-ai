-- Alter embedding column type in classroom_chunks to 1536 dimensions
ALTER TABLE public.classroom_chunks ALTER COLUMN embedding TYPE vector(1536);

-- Add modified_time column to classroom_documents to track document updates
ALTER TABLE public.classroom_documents ADD COLUMN IF NOT EXISTS modified_time TEXT;

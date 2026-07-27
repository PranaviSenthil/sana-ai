-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop table if exists
DROP TABLE IF EXISTS classroom_chunks;

-- Create classroom_chunks table
CREATE TABLE classroom_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    course_id VARCHAR(255) NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    google_file_id VARCHAR(255) NOT NULL,
    document_title VARCHAR(255) NOT NULL,
    course_name VARCHAR(255),
    source_type VARCHAR(50) NOT NULL,
    source_url TEXT,
    section_title VARCHAR(255),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for vector similarity and search queries
CREATE INDEX IF NOT EXISTS classroom_chunks_user_course_idx ON classroom_chunks(user_id, course_id);
CREATE INDEX IF NOT EXISTS classroom_chunks_doc_idx ON classroom_chunks(document_id);

-- Create HNSW index for pgvector similarity search
CREATE INDEX IF NOT EXISTS classroom_chunks_embedding_hnsw_idx ON classroom_chunks USING hnsw (embedding vector_cosine_ops);

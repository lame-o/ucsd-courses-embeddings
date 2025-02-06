# UCSD Course Embeddings

This project creates vector embeddings for UCSD courses using OpenAI's embedding model and stores them in Pinecone for semantic search capabilities.

## Features

- Fetches course data from Airtable
- Filters for valid lecture sections
- Creates embeddings using OpenAI's text-embedding-ada-002 model
- Stores course data and embeddings in Pinecone
- Provides semantic search functionality with metadata filtering

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
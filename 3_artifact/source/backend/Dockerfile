FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for asyncpg, pdfplumber etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy application code
# In dev: overridden by volume mount (./backend/app:/app/app)
COPY . .

EXPOSE 8000

# Entrypoint: runs migrations then starts uvicorn (hot reload only when DEBUG=true)
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]

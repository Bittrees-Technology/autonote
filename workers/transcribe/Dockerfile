FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home worker && mkdir /models && chown worker:worker /models
USER worker
ENV PYTHONUNBUFFERED=1
CMD ["python", "worker.py"]

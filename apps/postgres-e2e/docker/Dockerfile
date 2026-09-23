FROM postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-cron=1.6.8-1.pgdg12+1 \
    && rm -rf /var/lib/apt/lists/*

COPY 01-cron.sql /docker-entrypoint-initdb.d/01-cron.sql

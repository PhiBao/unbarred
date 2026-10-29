FROM rust:1.97-bookworm AS build
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY assets ./assets
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-dejavu-core \
    libasound2 \
    libgbm1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/unbarred-engine /usr/local/bin/unbarred-engine

ENV PORT=8787 \
    CHROME_PATH=/usr/bin/chromium \
    RUST_LOG=info

EXPOSE 8787
CMD ["unbarred-engine"]

FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y gcc make
WORKDIR /app
COPY backend/ .
RUN make

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/journal .
COPY dist ./dist
EXPOSE 8080
CMD ["./journal"]
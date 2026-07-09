# apps/analytics-consumer builds via @nx/esbuild (bundle: false), so the
# runtime image needs node_modules resolved from a pruned package.json +
# workspace_modules rather than a single self-contained bundle (unlike
# admin-api's Vite SSR build). This follows Nx's documented
# prune-lockfile + copy-workspace-modules pattern for Bun/npm workspaces.

FROM oven/bun:1.0.25 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx nx run @org/analytics-consumer:prune

FROM oven/bun:1.0.25-slim
WORKDIR /app
COPY --from=build /app/apps/analytics-consumer/dist ./
RUN bun install --production

EXPOSE 3009
CMD ["bun", "main.js"]

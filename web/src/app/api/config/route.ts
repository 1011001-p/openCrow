export function GET() {
  return Response.json({
    apiBaseUrl: process.env.API_BASE_URL || "http://localhost:8080",
    openCrowVersion: process.env.OPENCROW_VERSION || "dev",
  });
}

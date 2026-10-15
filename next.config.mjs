// rDash embeds PBE in an iframe, so only the rDash UI origin may frame it.
// No X-Frame-Options: DENY. If the origin is unset, framing is denied entirely
// rather than falling back to a permissive policy.
const rdashUiOrigin = process.env.NEXT_PUBLIC_RDASH_UI_ORIGIN;
if (!rdashUiOrigin) {
  console.warn("[next.config] NEXT_PUBLIC_RDASH_UI_ORIGIN is not set — frame-ancestors 'none'");
}
const frameAncestors = rdashUiOrigin ? `'self' ${rdashUiOrigin}` : "'none'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Enables src/instrumentation.ts (startup config validation). Stable in Next 15.
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` }],
      },
    ];
  },
};

export default nextConfig;

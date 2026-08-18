import type { MetadataRoute } from "next";

// Belt-and-suspenders alongside the password gate (§1) — this app should
// never be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}

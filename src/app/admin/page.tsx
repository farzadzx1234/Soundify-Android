"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-bold">404</h1>
        <p className="text-sm opacity-60">Page not found</p>
      </div>
    </div>
  );
}

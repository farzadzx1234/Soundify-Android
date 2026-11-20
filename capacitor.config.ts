import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.soundify.app",
  appName: "Soundify",
  webDir: "out",
  server: {
    androidScheme: "https",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#070810",
    buildOptions: {
      releaseType: "APK",
    },
  },
};

export default config;

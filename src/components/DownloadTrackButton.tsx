"use client";

import React, { memo } from "react";
import { DownloadButton, type DownloadButtonProps } from "./DownloadButton";
import type { Track } from "@/lib/types";

export type DownloadTrackButtonProps = DownloadButtonProps;

export const DownloadTrackButton = memo(function DownloadTrackButton(props: DownloadTrackButtonProps) {
  return <DownloadButton {...props} />;
});

export { DownloadButton };
export type { Track };
export default DownloadTrackButton;

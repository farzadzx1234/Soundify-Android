export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  displayNameFa: string;
  role: "user" | "creator" | "admin";
  avatarColor: string;
  isActive?: boolean;
  canAccessGlobalSearch?: boolean;
  isAdmin?: boolean;
}

export interface Track {
  id: string;
  title: string;
  titleFa: string;
  artistId: string;
  artistName: string;
  artistNameFa: string;
  artistAvatarColor: string;
  album: string;
  albumFa: string;
  genre: string;
  mood: string;
  durationSec: number;
  audioUrl: string;
  coverUrl: string;
  accentColor: string;
  waveform: number[];
  hasLyrics: boolean;
  lyricsSource: string;
  lyricsOffsetMs?: number;
  playsCount: number;
  dailyPlaysCount?: number;
  playsToday?: number;
  todayPlays?: number;
  likesCount: number;
  repostsCount: number;
  likedByMe: boolean;
  repostedByMe: boolean;
  uploadedBy?: string | null;
  createdAt?: string;
  source?: "local" | "youtube" | "soundcloud" | "spotify" | string;
  pageUrl?: string;
  qualityLabel?: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsSourceCandidate {
  source: string;
  name: string;
  isSynced: boolean;
  lineCount: number;
  lrcContent: string;
  providerTrackName?: string;
  providerArtistName?: string;
}

export interface TrackComment {
  id: string;
  trackId: string;
  userId: string;
  body: string;
  timestampSec: number;
  createdAt: string;
  author: {
    username: string;
    displayName: string;
    displayNameFa: string;
    avatarColor: string;
  };
}

export interface Playlist {
  id: string;
  title: string;
  titleFa: string;
  description: string;
  descriptionFa: string;
  ownerId?: string | null;
  isFeatured: boolean;
  accentColor: string;
  trackCount: number;
  coverUrls: string[];
  createdAt?: string;
}

export interface Artist {
  id: string;
  name: string;
  nameFa: string;
  bio: string;
  bioFa: string;
  avatarColor: string;
  verified: boolean;
  followersCount: number;
  trackCount?: number;
  followedByMe?: boolean;
}

export type ExternalMusicSource =
  | "all"
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "golsarmusic"
  | "nex1music"
  | "rozmusic"
  | "tabamusic"
  | "popmusic"
  | "itunes"
  | "musics-fa"
  | "upmusics";

export interface ProxySettings {
  proxy: string;
}

export interface ProxyTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface ExternalTrackCandidate {
  id: string;
  source: Exclude<ExternalMusicSource, "all">;
  title: string;
  titleFa: string;
  artistName: string;
  artistNameFa: string;
  album: string;
  albumFa: string;
  genre: string;
  durationSec: number | null;
  audioUrl: string | null;
  pageUrl: string;
  coverUrl: string | null;
  isPreview: boolean;
  qualityLabel: string;
}

export interface AdminStats {
  totalTracks: number;
  totalArtists: number;
  totalPlays: number;
  tracksWithLyrics: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  displayNameFa: string;
  role: "user" | "creator" | "admin";
  avatarColor: string;
  createdAt: string;
  isActive: boolean;
  canAccessGlobalSearch?: boolean;
  isAdmin?: boolean;
  likedTracksCount: number;
  playlistsCount: number;
  commentsCount: number;
}

export interface AdminUserDetails {
  user: AdminUser;
  likedTracks: Array<{
    id: string;
    title: string;
    titleFa: string;
    artistName: string;
    artistNameFa: string;
    coverUrl: string;
  }>;
  playlists: Array<{
    id: string;
    title: string;
    titleFa: string;
    isFeatured: boolean;
    accentColor: string;
    trackCount: number;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    body: string;
    timestampSec: number;
    createdAt: string;
    trackId: string;
    trackTitle: string;
    trackTitleFa: string;
  }>;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: "desktop" | "smartphone" | "tablet" | "browser" | "speaker";
  isActive: boolean;
  isCurrent: boolean;
  lastActive: string;
  brand?: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface PlaybackStateSync {
  activeDeviceId: string | null;
  trackId: string | null;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  updatedAt: number;
}

export interface UserSyncData {
  user: User | null;
  likedTrackIds: string[];
  likedTracks: Track[];
  repostedTrackIds?: string[];
  followedArtistIds?: string[];
  playlists: Playlist[];
  recentHistory: Track[];
  activeDevices: DeviceInfo[];
  devices?: DeviceInfo[];
  featuredTracks?: Track[];
  featuredPlaylists?: Playlist[];
  playbackState: PlaybackStateSync;
  preferences: Record<string, unknown>;
  serverTime: number;
  syncVersion: number;
}

export interface OfflineLicensePlaybackPolicy {
  allowOffline: boolean;
  renewIntervalHours: number;
}

export interface OfflineLicense {
  trackId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  audioChecksum: string;
  audioSize: number;
  audioMime: string;
  playbackPolicy: OfflineLicensePlaybackPolicy;
  signature: string;
}

export interface OfflineLicenseResponse {
  ok: boolean;
  trackId: string;
  title: string;
  downloadUrl: string;
  coverUrl: string;
  license: OfflineLicense;
}

export interface OfflineLicenseVerifyResponse {
  valid: boolean;
  trackId: string;
  expiresAt?: number;
  isExpired?: boolean;
  reason?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
  tokenType: "Bearer" | string;
  expiresIn: number;
}

export interface TokenRefreshResponse {
  token: string;
  refreshToken: string;
  tokenType: "Bearer" | string;
  expiresIn: number;
}

export interface BootstrapSyncData {
  user: User | null;
  likedTrackIds: string[];
  likedTracks: Track[];
  playlists: Playlist[];
  recentHistory: Track[];
  featuredTracks: Track[];
  featuredPlaylists: Playlist[];
  devices: DeviceInfo[];
  playbackState: PlaybackStateSync;
  serverTime: number;
  syncVersion: number;
}

export interface DeltaSyncResponse {
  since: number;
  serverTime: number;
  newLikedTrackIds: string[];
  newPlaylistIds: string[];
}

export interface LibraryLikesBatchPayload {
  likedTrackIds?: string[];
  unlikedTrackIds?: string[];
}

export interface LibraryLikesBatchResponse {
  ok: boolean;
  likedTrackIds: string[];
  syncedCount: number;
}

export interface PlaylistCreatePayload {
  title: string;
  titleFa?: string;
  description?: string;
  descriptionFa?: string;
  accentColor?: string;
}

export interface PlaylistUpdatePayload {
  title?: string;
  titleFa?: string;
  description?: string;
  descriptionFa?: string;
  accentColor?: string;
}

export interface PlaylistTracksReorderPayload {
  trackIds: string[];
}

export interface MobileStatus {
  status: string;
  app: string;
  version: string;
  apiLevel: number;
  timestamp: number;
  features: {
    audioStream206: boolean;
    lrcLyrics: boolean;
    deviceSync: boolean;
    userSync: boolean;
    offlineCache: boolean;
    translucentGlass: boolean;
    transportSecurity?: boolean;
    payloadEncryption?: boolean;
    replayProtection?: boolean;
    rateLimiting?: boolean;
  };
  diagnostics?: {
    databaseConnected: boolean;
    dbLatencyMs: number;
    activeDevicesCount: number;
    storageReady: boolean;
    uptimeSec: number;
  };
}

export interface MobileHealthDiagnostic {
  status: "healthy" | "degraded" | "unhealthy";
  app: string;
  version: string;
  service: string;
  timestamp: number;
  isoTime: string;
  uptimeSec: number;
  totalLatencyMs: number;
  database: {
    status: string;
    latencyMs: number;
    error: string | null;
    sqlite?: Record<string, unknown>;
    counts: {
      users: number;
      tracks: number;
      artists: number;
      playlists: number;
      devices: number;
      activeDevices90s: number;
    };
  };
  storage: {
    ready: boolean;
    storageDir?: string;
    audioFiles: number;
    coverFiles: number;
    writable: boolean;
  };
  system: {
    nodeVersion: string;
    platform: string;
    memory: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
    };
  };
  security: {
    transportEncryption: boolean;
    replayProtection: boolean;
    rateLimiting: boolean;
    activeSessions?: number;
    cachedNonces?: number;
  };
}

export interface EncryptedEnvelope {
  encrypted: true;
  iv: string;
  tag: string;
  ciphertext: string;
  sessionId?: string;
  timestamp?: number;
}

export interface SecurityHandshakeResult {
  ok: boolean;
  sessionId: string;
  serverPublicKey: string;
  serverNonce: string;
  expiresAt: number;
  algorithm: string;
}

export interface MobileDeviceRegistrationPayload {
  id: string;
  name: string;
  type?: "smartphone" | "tablet" | "desktop" | "browser";
  brand?: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
  fcmToken?: string;
}

export interface UserProfileUpdatePayload {
  displayName?: string;
  displayNameFa?: string;
  avatarColor?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}


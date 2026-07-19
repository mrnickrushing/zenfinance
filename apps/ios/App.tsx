import * as Sentry from '@sentry/react-native';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import materialSymbolsMap from './assets/fonts/material-symbols-map.json';
import { budgetCategories, moneyMovementDisplay, type BudgetPeriod } from './src/budget';
import { appliedBudgetTarget, appliedCategoryCaps, buildBudgetPlanRequest, canApplyBudgetPlan } from './src/budgetPlan';
import { useAuthScreenState } from './src/hooks/useAuthScreenState';
import { useReducerState } from './src/hooks/useReducerState';
import { useSettingsScreenState } from './src/hooks/useSettingsScreenState';
import { styles } from './src/styles';
import {
  PROFILE_MENU_GROUPS,
  SETTINGS_SECTION_COPY,
  type ProfileDestination,
  type SettingsSection,
} from './src/profileNavigation';
import { resolveApiUrl, resolveSentryDsn, safeAppStoreSubscriptionUrl } from './src/security';
import { buildWhatIfRequest, hasAdvancedWhatIfAdjustments, type WhatIfDraft } from './src/whatIf';
import { zenScoreCoachPrompt, zenScoreFocus, zenScoreGuidance, type ZenScoreDestination } from './src/zenScore';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import * as Crypto from 'expo-crypto';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import * as Updates from 'expo-updates';
import { StatusBar } from 'expo-status-bar';
import {
  Bell,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Crown,
  Gift,
  Home,
  Landmark,
  LockKeyhole,
  Minus,
  LogOut,
  MessageCircle,
  Moon,
  PiggyBank,
  Plus,
  RefreshCcw,
  RotateCcw,
  CloudOff,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  Volume2,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react-native';
import { Component, useCallback, useEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  Animated,
  Alert,
  AppState as NativeAppState,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable as RNPressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  type PressableProps,
  type TextProps,
  useColorScheme,
  useWindowDimensions,
  View,
  Easing,
} from 'react-native';
import {
  Circle as SvgCircle,
  Defs,
  Ellipse,
  G,
  Line as SvgLine,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Svg,
} from 'react-native-svg';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { create as createStore } from 'zustand';
import { MONEY_PHYSICAL_PRODUCT_ID } from '@zenfinance/shared';
import type {
  AccountProfileView,
  AnomalyView,
  AuthTokens,
  BillingStatusView,
  BudgetPlanView,
  ChatAnswerView,
  FreelancerSummaryView,
  GoalView,
  HouseholdInviteCreatedView,
  HouseholdStatusView,
  InsightView,
  EnrichedTransactionView,
  LinkedItem,
  LinkedAccount,
  MobileHomeSummaryView,
  MoneyPhysicalStatusView,
  MoneyWinsSummaryView,
  NotificationPreferencesView,
  PaywallPackageView,
  ReferralRedeemView,
  ReferralStatusView,
  SubscriptionAuditView,
  UserDataExportView,
  VoiceBriefView,
  WhatIfResultView,
  ZenScoreComponent,
} from '@zenfinance/shared';

const API_URL = resolveApiUrl(Constants.expoConfig?.extra?.apiUrl, __DEV__);
const SENTRY_DSN = resolveSentryDsn(Constants.expoConfig?.extra?.sentryDsn);
const REVENUECAT_IOS_API_KEY: string | undefined = Constants.expoConfig?.extra?.revenueCatIosApiKey || undefined;
const OTA_DIAGNOSTIC_LABEL = 'AI goal budget plan · 2026-07-18.4';
const DEVICE_BOUND_STORE_OPTIONS = Platform.OS === 'ios'
  ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
  : undefined;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0.2,
    beforeSend(event) {
      event.user = undefined;
      if (event.request) {
        event.request.cookies = undefined;
        event.request.data = undefined;
        event.request.headers = undefined;
        event.request.query_string = undefined;
      }
      return event;
    },
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

type TabKey = 'brief' | 'coach' | 'transactions' | 'profile' | 'goals' | 'subs' | 'wins' | 'settings' | 'budget' | 'score' | 'link';
const ALL_TABS = new Set<TabKey>(['brief', 'coach', 'transactions', 'profile', 'goals', 'subs', 'wins', 'settings', 'budget', 'score', 'link']);
const PREMIUM_TABS = new Set<TabKey>(['coach', 'subs', 'wins']);

type RevenueCatCustomerInfo = Awaited<ReturnType<typeof Purchases.restorePurchases>>;
type RevenueCatPackage = NonNullable<Awaited<ReturnType<typeof Purchases.getOfferings>>['current']>['availablePackages'][number];
type RevenueCatStoreProduct = Awaited<ReturnType<typeof Purchases.getProducts>>[number];
type RestorePayload = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  active: boolean;
  expirationDate?: string | null;
  latestPurchaseDate?: string | null;
  willRenew?: boolean | null;
  managementUrl?: string | null;
  store?: string;
  environment: 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN';
};
type MoneyPhysicalRestorePayload = {
  appUserId: string;
  productId: string;
  transactionId: string;
  purchaseDate?: string | null;
  store?: string;
  environment: 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN';
};

let configuredRevenueCatUserId: string | null = null;

interface AppState {
  accessToken: string | null;
  refreshToken: string | null;
  home: MobileHomeSummaryView | null;
  notificationPrefs: NotificationPreferencesView | null;
  loading: boolean;
  setTokens: (tokens: AuthTokens | null) => void;
  setHome: (home: MobileHomeSummaryView | null) => void;
  setNotificationPrefs: (prefs: NotificationPreferencesView | null) => void;
  setLoading: (loading: boolean) => void;
}

const useAppStore = createStore<AppState>((set) => ({
  accessToken: null,
  refreshToken: null,
  home: null,
  notificationPrefs: null,
  loading: true,
  setTokens: (tokens) => set({ accessToken: tokens?.accessToken ?? null, refreshToken: tokens?.refreshToken ?? null }),
  setHome: (home) => set({ home }),
  setNotificationPrefs: (notificationPrefs) => set({ notificationPrefs }),
  setLoading: (loading) => set({ loading }),
}));

const midnightZen = {
  bg: '#0B0E14',
  surface: '#FFFFFF0D',
  surfaceAlt: '#FFFFFF08',
  ink: '#FFFFFF',
  muted: '#FFFFFF99',
  border: '#FFFFFF26',
  accent: '#00D2D3',
  accentBright: '#48EFEF',
  accentSoft: '#00D2D326',
  violet: '#8E44AD',
  violetSoft: '#8E44AD26',
  gold: '#F5D58A',
  goldSoft: '#F5D58A26',
  danger: '#FF7A9A',
  success: '#79E6B0',
};

const light = midnightZen;
const dark = midnightZen;

function usd(cents: number | null | undefined, compact = false): string {
  if (cents === null || cents === undefined) return '$0';
  const value = cents / 100;
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: compact ? 0 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  });
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function latestSyncLabel(items: LinkedItem[]): string {
  const timestamps = items
    .map((item) => (item.lastSyncedAt ? new Date(item.lastSyncedAt).getTime() : 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length === 0) return 'No sync yet';
  return `Synced ${dateLabel(new Date(Math.max(...timestamps)).toISOString())}`;
}

function centsToDollarInput(cents: number | null | undefined): string {
  if (!cents) return '';
  return String(Math.round(cents / 100));
}

function dollarInputToCents(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

async function persistTokens(tokens: AuthTokens | null): Promise<void> {
  if (!tokens) {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    return;
  }
  await SecureStore.setItemAsync('accessToken', tokens.accessToken, DEVICE_BOUND_STORE_OPTIONS);
  await SecureStore.setItemAsync('refreshToken', tokens.refreshToken, DEVICE_BOUND_STORE_OPTIONS);
}

let refreshPromise: Promise<AuthTokens | null> | null = null;
const API_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error('The request timed out. Check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

async function refreshAuthTokens(): Promise<AuthTokens | null> {
  refreshPromise ??= (async () => {
    const refreshToken = useAppStore.getState().refreshToken ?? (await SecureStore.getItemAsync('refreshToken'));
    if (!refreshToken) return null;
    const refresh = await fetchWithTimeout(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!refresh.ok) return null;
    return (await refresh.json()) as AuthTokens;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function requestApi<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = useAppStore.getState().accessToken ?? (await SecureStore.getItemAsync('accessToken'));
  const res = await fetchWithTimeout(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && retry) {
    const tokens = await refreshAuthTokens();
    if (tokens) {
      await persistTokens(tokens);
      useAppStore.getState().setTokens(tokens);
      return requestApi<T>(path, init, false);
    }
    await persistTokens(null);
    useAppStore.getState().setTokens(null);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiRequestError(
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.error?.code,
      body?.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function trackBillingEvent(name: string, properties: Record<string, unknown> = {}): Promise<void> {
  await requestApi('/api/billing/events', {
    method: 'POST',
    body: JSON.stringify({ name, properties }),
  }).catch(() => {});
}

async function configureRevenueCat(billing: BillingStatusView): Promise<boolean> {
  if (!REVENUECAT_IOS_API_KEY || Platform.OS !== 'ios') return false;
  const alreadyConfigured = await Purchases.isConfigured().catch(() => false);
  if (alreadyConfigured && configuredRevenueCatUserId === billing.appUserId) return true;
  await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN).catch(() => {});
  if (alreadyConfigured) {
    await Purchases.logIn(billing.appUserId);
  } else {
    Purchases.configure({
      apiKey: REVENUECAT_IOS_API_KEY,
      appUserID: billing.appUserId,
    } as Parameters<typeof Purchases.configure>[0]);
  }
  configuredRevenueCatUserId = billing.appUserId;
  return true;
}

async function clearRevenueCatIdentity(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const configured = await Purchases.isConfigured().catch(() => false);
  if (configured) await Purchases.logOut().catch(() => {});
  configuredRevenueCatUserId = null;
}

async function signOutUser(): Promise<void> {
  const pushToken = await SecureStore.getItemAsync('expoPushToken').catch(() => null);
  if (pushToken) {
    const removed = await requestApi('/api/push-tokens', {
      method: 'DELETE',
      body: JSON.stringify({ token: pushToken, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
    }).then(() => true).catch(() => false);
    if (!removed) {
      Alert.alert(
        'Sign-out paused',
        'Zen-Finance could not disable financial notifications for this device. Check your connection and try signing out again.',
      );
      return;
    }
    await SecureStore.deleteItemAsync('expoPushToken').catch(() => {});
  }
  const refreshToken = useAppStore.getState().refreshToken;
  if (refreshToken) {
    await requestApi('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => {});
  }
  await clearRevenueCatIdentity();
  await SecureStore.deleteItemAsync(BUDGET_CONFIG_KEY).catch(() => {});
  try {
    await persistTokens(null);
  } finally {
    useAppStore.getState().setTokens(null);
  }
}

function restorePayloadFromCustomerInfo(billing: BillingStatusView, customerInfo: RevenueCatCustomerInfo): RestorePayload {
  const activeEntitlement = customerInfo.entitlements.active[billing.entitlementId];
  const entitlement = activeEntitlement ?? customerInfo.entitlements.all[billing.entitlementId];
  return {
    appUserId: billing.appUserId,
    entitlementId: billing.entitlementId,
    productId: entitlement?.productIdentifier ?? customerInfo.activeSubscriptions[0],
    active: Boolean(activeEntitlement?.isActive),
    expirationDate: entitlement?.expirationDate ?? customerInfo.latestExpirationDate,
    latestPurchaseDate: entitlement?.latestPurchaseDate ?? null,
    willRenew: entitlement?.willRenew ?? null,
    managementUrl: customerInfo.managementURL,
    store: entitlement?.store ? String(entitlement.store) : undefined,
    environment: entitlement ? (entitlement.isSandbox ? 'SANDBOX' : 'PRODUCTION') : 'UNKNOWN',
  };
}

function moneyPhysicalPayloadFromCustomerInfo(
  billing: BillingStatusView,
  customerInfo: RevenueCatCustomerInfo,
): MoneyPhysicalRestorePayload | null {
  const transaction = [...customerInfo.nonSubscriptionTransactions]
    .reverse()
    .find((txn) => txn.productIdentifier === MONEY_PHYSICAL_PRODUCT_ID);
  if (!transaction) return null;
  return {
    appUserId: billing.appUserId,
    productId: MONEY_PHYSICAL_PRODUCT_ID,
    transactionId: transaction.transactionIdentifier,
    purchaseDate: transaction.purchaseDate,
    store: Platform.OS === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
    environment: 'UNKNOWN',
  };
}

function useTheme() {
  useColorScheme();
  return midnightZen;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useReducerState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  return reduceMotion;
}

function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.globalText, style]} />;
}

function Pressable({ accessibilityRole = 'button', ...props }: PressableProps) {
  return <RNPressable accessibilityRole={accessibilityRole} {...props} />;
}

// Renders a glyph from the same "Material Symbols Outlined" font Stitch used
// for every icon in the designs, subset down to just the names in use (see
// assets/fonts/material-symbols-map.json) — pixel-identical to the renders
// instead of a stand-in from a different icon set.
type MaterialSymbolName = keyof typeof materialSymbolsMap;

function MaterialSymbol({
  name,
  size = 24,
  color = '#FFFFFF',
  style,
}: {
  name: MaterialSymbolName;
  size?: number;
  color?: string;
  style?: object;
}) {
  const glyph = String.fromCodePoint(parseInt(materialSymbolsMap[name], 16));
  return (
    <RNText
      style={[
        { fontFamily: 'MaterialSymbolsOutlined', fontSize: size, lineHeight: size, color, includeFontPadding: false },
        style,
      ]}
    >
      {glyph}
    </RNText>
  );
}

// Deterministic star field (blueprint: "particles — small white dots at 10%
// opacity — moving slowly upwards"). Seeded PRNG so positions are stable
// across renders instead of reshuffling every time ZenBackdrop mounts.
function seededStars(seed: number, count: number) {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    r: 0.4 + rand() * 1.1,
    o: 0.04 + rand() * 0.08,
  }));
}
const ZEN_STARS = seededStars(42, 40);
// Two vertically-tiled copies of the same star pattern so the upward drift
// loops seamlessly — as the top copy scrolls off, the bottom one is identical.
const ZEN_STAR_DOTS = ZEN_STARS.flatMap((star, i) => [
  { key: `${i}-a`, cx: star.x, cy: star.y, r: star.r, o: star.o },
  { key: `${i}-b`, cx: star.x, cy: star.y + 100, r: star.r, o: star.o },
]);

function ZenBackdrop() {
  const phase = useRef(new Animated.Value(0)).current;
  const starDrift = useRef(new Animated.Value(0)).current;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(starDrift, { toValue: 1, duration: 50000, easing: Easing.linear, useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, starDrift]);

  const starTransform = {
    transform: [{ translateY: starDrift.interpolate({ inputRange: [0, 1], outputRange: [0, -screenHeight] }) }],
  };

  const tealTransform = {
    transform: [
      { translateX: phase.interpolate({ inputRange: [0, 1], outputRange: [-22, 30] }) },
      { translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [24, -18] }) },
      { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) },
    ],
  };
  const violetTransform = {
    transform: [
      { translateX: phase.interpolate({ inputRange: [0, 1], outputRange: [24, -28] }) },
      { translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [-16, 22] }) },
      { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1.08, 0.94] }) },
    ],
  };

  return (
    <View pointerEvents="none" style={styles.zenBackdrop}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="tealGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#00D2D3" stopOpacity="0.28" />
            <Stop offset="1" stopColor="#00D2D3" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="violetGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#8E44AD" stopOpacity="0.32" />
            <Stop offset="1" stopColor="#8E44AD" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#1D74B7" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#1D74B7" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="greenGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#3FE0A5" stopOpacity="0.3" />
            <Stop offset="1" stopColor="#3FE0A5" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="#0B0E14" />
        <Ellipse cx="8%" cy="12%" rx="62%" ry="36%" fill="url(#tealGlow)" />
        <Ellipse cx="90%" cy="10%" rx="58%" ry="34%" fill="url(#violetGlow)" />
        <Ellipse cx="82%" cy="68%" rx="68%" ry="42%" fill="url(#blueGlow)" />
        <Ellipse cx="12%" cy="60%" rx="60%" ry="38%" fill="url(#greenGlow)" />
        <SvgCircle cx="20%" cy="82%" r="34%" fill="url(#violetGlow)" opacity="0.6" />
        <SvgCircle cx="55%" cy="40%" r="40%" fill="url(#greenGlow)" opacity="0.4" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, reduceMotion ? null : starTransform]}>
        <Svg width="100%" height="200%" viewBox="0 0 100 200" preserveAspectRatio="none">
          {ZEN_STAR_DOTS.map((d) => (
            // The viewBox is stretched non-uniformly to fill the screen, so a
            // uniform ry (rather than r) keeps these round instead of turning
            // into stretched "raindrop" ellipses.
            <Ellipse key={d.key} cx={d.cx} cy={d.cy} rx={d.r} ry={d.r * (screenWidth / screenHeight)} fill="#FFFFFF" opacity={d.o} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

function ZenGlass({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[styles.zenGlass, { borderColor: theme.border }, style]}>
      <BlurView intensity={28} tint="dark" style={styles.zenGlassBlur as any} />
      <View pointerEvents="none" style={styles.zenGlassTint} />
      {children}
    </View>
  );
}

// Layered lotus — the zen/mindfulness bloom, built from react-native-svg so it
// scales crisply from the 15px inline marks to the 84px score hero. Seven
// petals fan from a shared base with a lit gradient, a soft interior wash, and
// a seed crown; a radial aura sits behind it. The breathing opacity below makes
// the whole mark (aura included) gently glow — animation stays in Animated so
// it works natively (react-native-svg has no SMIL).
const LOTUS_PETALS = [
  { r: -66, s: 0.82, o: 0.6 },
  { r: 66, s: 0.82, o: 0.6 },
  { r: -42, s: 0.9, o: 0.82 },
  { r: 42, s: 0.9, o: 0.82 },
  { r: -20, s: 0.96, o: 1 },
  { r: 20, s: 0.96, o: 1 },
  { r: 0, s: 1, o: 1 },
];
const LOTUS_PETAL = 'M0 0 C -10 -14 -9 -29 0 -42 C 9 -29 10 -14 0 0 Z';
const LOTUS_VEIN = 'M0 -3 C -1.6 -15 -1.2 -29 0 -38';

// "The First Breath" (animation spec): scale 1→1.08, opacity 0.7→1 over a 4s
// yoyo cycle on the standard bezier(0.4,0,0.2,1) curve. Shared by every mark
// that should "breathe" — the lotus itself, and the Coach's avatar icon.
function useZenBreath() {
  const breathe = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2000, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2000, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [breathe, reduceMotion]);

  return {
    opacity: reduceMotion ? 1 : breathe.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
    scale: reduceMotion ? 1 : breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
  };
}

function ZenLotus({ size = 18 }: { size?: number }) {
  const { opacity, scale } = useZenBreath();
  // Unique gradient ids per instance so multiple lotuses on one screen (e.g.
  // profile avatar + score pill) don't collide on a shared def id.
  const uid = useRef(Math.random().toString(36).slice(2, 8)).current;
  const sid = `zl-s-${uid}`;
  const fid = `zl-f-${uid}`;
  const aid = `zl-a-${uid}`;

  return (
    <Animated.View
      style={{ opacity, transform: [{ scale }] }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={sid} gradientUnits="userSpaceOnUse" x1="50" y1="28" x2="50" y2="74">
            <Stop offset="0" stopColor="#B8FFFF" />
            <Stop offset="0.5" stopColor={midnightZen.accent} />
            <Stop offset="1" stopColor="#0A9C9D" />
          </LinearGradient>
          <LinearGradient id={fid} gradientUnits="userSpaceOnUse" x1="50" y1="30" x2="50" y2="74">
            <Stop offset="0" stopColor="#8AFFFF" stopOpacity="0.5" />
            <Stop offset="0.7" stopColor={midnightZen.accent} stopOpacity="0.14" />
            <Stop offset="1" stopColor={midnightZen.accent} stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id={aid} cx="50" cy="54" r="46" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#8AFFFF" stopOpacity="0.55" />
            <Stop offset="0.45" stopColor={midnightZen.accent} stopOpacity="0.22" />
            <Stop offset="1" stopColor={midnightZen.accent} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Ellipse cx="50" cy="54" rx="48" ry="44" fill={`url(#${aid})`} />

        {LOTUS_PETALS.map((p) => (
          <G key={`${p.r}-${p.s}`} transform={`translate(50 72) rotate(${p.r}) scale(${p.s})`} opacity={p.o}>
            <Path d={LOTUS_PETAL} fill={`url(#${fid})`} stroke={`url(#${sid})`} strokeWidth={2} strokeLinejoin="round" />
            <Path d={LOTUS_VEIN} fill="none" stroke={`url(#${sid})`} strokeWidth={1} strokeLinecap="round" opacity={0.5} />
          </G>
        ))}

        <G stroke={`url(#${sid})`} fill="none" strokeLinecap="round">
          <SvgCircle cx="50" cy="61" r="4.2" strokeWidth={1.1} opacity={0.5} />
          <SvgCircle cx="50" cy="61" r="1.4" fill="#8AFFFF" stroke="none" />
          <SvgLine x1="50" y1="61" x2="50" y2="55" strokeWidth={1.1} />
          <SvgLine x1="50" y1="61" x2="45" y2="57" strokeWidth={1.1} />
          <SvgLine x1="50" y1="61" x2="55" y2="57" strokeWidth={1.1} />
        </G>
      </Svg>
    </Animated.View>
  );
}

// Photoreal lotus renders extracted from the Stitch designs (Onboarding,
// Zen Score Details, Milestone popup each used a distinct render — Stitch
// never exported one reusable asset). Cropped + alpha-matted from the source
// screens since no transparent export exists; breathes on the same "First
// Breath" cadence as the vector ZenLotus.
const LOTUS_PHOTOS = {
  onboarding: { source: require('./assets/images/lotus-onboarding.png'), ratio: 570 / 440 },
  score: { source: require('./assets/images/lotus-score.png'), ratio: 463 / 313 },
  milestone: { source: require('./assets/images/lotus-milestone.png'), ratio: 341 / 270 },
} as const;

function ZenLotusPhoto({ variant, width }: { variant: keyof typeof LOTUS_PHOTOS; width: number }) {
  const { opacity, scale } = useZenBreath();
  const { source, ratio } = LOTUS_PHOTOS[variant];
  return (
    <Animated.View style={{ opacity, transform: [{ scale }], alignItems: 'center' }}>
      <Image source={source} style={{ width, height: width / ratio }} resizeMode="contain" />
    </Animated.View>
  );
}

function ZenScoreCard({ score }: { score: number }) {
  return (
    <ZenGlass style={styles.zenScoreCard}>
      <View style={styles.zenScoreAura}>
        <ZenLotus size={42} />
      </View>
      <Text style={styles.zenScoreEyebrow}>ZEN SCORE</Text>
      <Text style={styles.zenScoreNumber}>{score}<Text style={styles.zenScoreDenom}>/100</Text></Text>
      <Text style={styles.zenScoreCaption}>Balanced and steady</Text>
    </ZenGlass>
  );
}

function ZenStonesIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Ellipse cx="12" cy="19" rx="9" ry="3.2" fill="#5B6B7A" />
      <Ellipse cx="12" cy="13" rx="7" ry="2.9" fill="#71828F" />
      <Ellipse cx="12" cy="7.5" rx="5" ry="2.4" fill="#8A98A3" />
    </Svg>
  );
}

function ZenScorePill({ score }: { score: number | null }) {
  return (
    <ZenGlass style={styles.zenScorePill}>
      <View style={styles.zenScoreIcon}><ZenStonesIcon size={19} /></View>
      <Text style={styles.zenScoreText}>{score === null ? 'Zen Score: building' : `Zen Score: ${score}/100`}</Text>
      <View style={styles.zenScoreDot} />
    </ZenGlass>
  );
}

type IconComponent = typeof Sparkles;

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } }); }
  render() {
    if (this.state.failed) {
      return <SafeAreaView style={[styles.center, { backgroundColor: midnightZen.bg }]}><Text style={{ color: midnightZen.ink }}>Zen-Finance hit an unexpected problem.</Text><SecondaryButton label="Try again" onPress={() => this.setState({ failed: false })} /></SafeAreaView>;
    }
    return this.props.children;
  }
}

export default function App() {
  const { accessToken, loading, setTokens, setLoading } = useAppStore();
  const theme = useTheme();
  const [privacyShielded, setPrivacyShielded] = useReducerState(NativeAppState.currentState !== 'active');
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    MaterialSymbolsOutlined: require('./assets/fonts/MaterialSymbolsOutlined.ttf'),
  });

  useEffect(() => {
    void (async () => {
      try {
        const [access, refresh] = await Promise.all([
          SecureStore.getItemAsync('accessToken'),
          SecureStore.getItemAsync('refreshToken'),
        ]);
        const tokens = access && refresh ? { accessToken: access, refreshToken: refresh } : null;
        if (tokens) await persistTokens(tokens);
        setTokens(tokens);
      } catch (err) {
        Sentry.captureException(err);
        setTokens(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [setLoading, setTokens]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', (state) => {
      setPrivacyShielded(state !== 'active');
    });
    return () => subscription.remove();
  }, []);

  if (loading || (!fontsLoaded && !fontError)) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.flex}>
      <AppErrorBoundary>{accessToken ? <ProductShell /> : <AuthScreen />}</AppErrorBoundary>
      {accessToken && privacyShielded ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.privacyShield}
        />
      ) : null}
    </View>
  );
}

function ZenOnboardingWelcome({ onStart }: { onStart: () => void }) {
  return (
    <SafeAreaView style={styles.onboardingScreen}>
      <ZenBackdrop />
      <Pressable style={styles.onboardingSkip} onPress={onStart}><Text style={styles.onboardingSkipText}>Skip</Text></Pressable>
      <View style={styles.onboardingHero}>
        <View style={styles.onboardingLotus}><ZenLotusPhoto variant="onboarding" width={220} /></View>
        <Text style={styles.onboardingTitle}>Find your{`\n`}financial peace.</Text>
        <Text style={styles.onboardingBody}>AI-powered coaching to help you reach your goals without the stress.</Text>
      </View>
      <PrimaryButton label="Start Your Journey" icon={ChevronRight} onPress={onStart} />
    </SafeAreaView>
  );
}

function AuthScreen() {
  const theme = useTheme();
  const setTokens = useAppStore((s) => s.setTokens);
  const {
    transaction, setTransaction, brief, setBrief, email, setEmail, password, setPassword,
    busy, setBusy, showLogin, setShowLogin, mode, setMode, touched, setTouched,
    appleAvailable, setAppleAvailable, reset, setReset, resetCode, setResetCode,
  } = useAuthScreenState();

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Registration requires 10+ (server registerSchema); sign-in only needs a
  // non-empty password.
  const passwordMin = mode === 'register' ? 10 : 1;
  const passwordValid = password.length >= passwordMin;
  const formValid = emailValid && passwordValid;
  const emailError = touched && email.length > 0 && !emailValid ? 'Enter a valid email address.' : null;
  const passwordError =
    touched && password.length > 0 && !passwordValid ? `Use at least ${passwordMin} characters.` : null;

  async function requestReset() {
    if (!emailValid) {
      setTouched(true);
      return;
    }
    setBusy(true);
    try {
      await requestApi('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }, false);
      setReset('confirm');
    } catch (err) {
      Alert.alert('Could not send code', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset() {
    if (!/^\d{6}$/.test(resetCode) || password.length < 10) {
      setTouched(true);
      Alert.alert('Check your entries', 'Enter the 6-digit code and a new password of at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      await requestApi(
        '/api/auth/reset',
        { method: 'POST', body: JSON.stringify({ email: email.trim(), code: resetCode, password }) },
        false,
      );
      setReset('off');
      setResetCode('');
      setPassword('');
      setMode('login');
      Alert.alert('Password updated', 'You can now sign in with your new password.');
    } catch (err) {
      Alert.alert('Reset failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  function generateBrief() {
    const input = transaction.trim().toLowerCase();
    if (input.includes('subscription') || input.includes('stream') || input.includes('netflix')) {
      setBrief({
        action: 'Cancel one unused subscription before it renews and move that money toward your buffer.',
        impact: 'Potential impact: Save $60/yr',
      });
      return;
    }
    if (input.includes('coffee') || input.includes('cafe')) {
      setBrief({
        action: 'Set a $25 coffee cap for the rest of the week and keep the difference in savings.',
        impact: 'Potential impact: Save $18',
      });
      return;
    }
    setBrief({
      action: 'Cap dining out at $100 to stay on track for your Japan trip goal.',
      impact: 'Potential impact: Save $45',
    });
  }

  async function submit() {
    setTouched(true);
    if (!formValid) return;
    const path = mode;
    setBusy(true);
    try {
      const tokens = await requestApi<AuthTokens>(
        `/api/auth/${path}`,
        { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) },
        false,
      );
      await persistTokens(tokens);
      setTokens(tokens);
      void requestApi('/api/app-events', {
        method: 'POST',
        body: JSON.stringify({ name: path === 'register' ? 'onboarding:registered' : 'onboarding:logged_in' }),
      }).catch(() => {});
    } catch (err) {
      Alert.alert(
        path === 'register' ? 'Could not create account' : 'Sign-in failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signInWithApple() {
    setBusy(true);
    try {
      // Firebase-style nonce: send Apple the SHA-256 of a raw nonce, then hand
      // the server the raw value. /api/auth/apple re-hashes it and matches the
      // token's nonce claim, so a stolen identity token can't be replayed.
      const rawNonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) throw new Error('Apple did not return an identity token');
      const tokens = await requestApi<AuthTokens>(
        '/api/auth/apple',
        {
          method: 'POST',
          body: JSON.stringify({
            identityToken: credential.identityToken,
            rawNonce,
            ...(credential.email ? { email: credential.email } : {}),
          }),
        },
        false,
      );
      await persistTokens(tokens);
      setTokens(tokens);
      void requestApi('/api/app-events', {
        method: 'POST',
        body: JSON.stringify({ name: 'onboarding:apple_sign_in' }),
      }).catch(() => {});
    } catch (err) {
      // User dismissed the native sheet — not an error worth surfacing.
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
        return;
      }
      Alert.alert('Apple sign-in failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  if (!showLogin) {
    return <ZenOnboardingWelcome onStart={() => setShowLogin(true)} />;
  }

  return (
    <SafeAreaView style={[styles.authScreen, { backgroundColor: theme.bg }]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.authContentV2} showsVerticalScrollIndicator={false}>
        <View style={styles.authBrandRow}>
          <View style={[styles.authLogo, { backgroundColor: theme.surface }]}>
            <Sparkles color={theme.accent} size={24} />
          </View>
          <Text style={styles.authBrandText}>Zen-Finance</Text>
        </View>

        <Text style={styles.heroTitleV2}>
          Know what to do with your money today.
        </Text>
        <Text style={styles.heroCopyV2}>
          Link your accounts and get one plain-English move from your real transactions.
        </Text>

        {reset !== 'off' ? (
          <View style={[styles.authPanelV2, { borderColor: theme.border }]}>
            <Text style={styles.authModeTitle}>Reset your password</Text>
            {reset === 'request' ? (
              <>
                <Text style={styles.authFieldHint}>Enter your email and we'll send a 6-digit reset code.</Text>
                <TextInput
                  style={[styles.authInputV2, emailError ? styles.authInputError : null]}
                  placeholder="Email"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  accessibilityLabel="Email"
                />
                {emailError ? <Text style={styles.authFieldError}>{emailError}</Text> : null}
                <PrimaryButton label={busy ? 'Sending...' : 'Send reset code'} icon={Send} disabled={busy} onPress={requestReset} />
              </>
            ) : (
              <>
                <Text style={styles.authFieldHint}>We sent a code to {email}. Enter it with a new password.</Text>
                <TextInput
                  style={styles.authInputV2}
                  placeholder="6-digit code"
                  placeholderTextColor={theme.muted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={resetCode}
                  onChangeText={setResetCode}
                  accessibilityLabel="Reset code"
                />
                <TextInput
                  style={styles.authInputV2}
                  placeholder="New password (10+ characters)"
                  placeholderTextColor={theme.muted}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel="New password"
                />
                <PrimaryButton label={busy ? 'Working...' : 'Reset password'} icon={ShieldCheck} disabled={busy} onPress={confirmReset} />
                <Pressable style={styles.authModeToggle} onPress={requestReset} accessibilityRole="button">
                  <Text style={styles.authModeToggleText}>Didn't get it? <Text style={styles.authModeToggleLink}>Resend</Text></Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={styles.authModeToggle}
              onPress={() => {
                setReset('off');
                setResetCode('');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.authModeToggleText}>Back to <Text style={styles.authModeToggleLink}>sign in</Text></Text>
            </Pressable>
          </View>
        ) : (
        <View style={[styles.authPanelV2, { borderColor: theme.border }]}>
          <Text style={styles.authModeTitle}>{mode === 'register' ? 'Create your account' : 'Welcome back'}</Text>
          <TextInput
            style={[styles.authInputV2, emailError ? styles.authInputError : null]}
            placeholder="Email"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            onBlur={() => setTouched(true)}
            accessibilityLabel="Email"
          />
          {emailError ? <Text style={styles.authFieldError}>{emailError}</Text> : null}
          <TextInput
            style={[styles.authInputV2, passwordError ? styles.authInputError : null]}
            placeholder={mode === 'register' ? 'Password (10+ characters)' : 'Password'}
            placeholderTextColor={theme.muted}
            secureTextEntry
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            textContentType={mode === 'register' ? 'newPassword' : 'password'}
            value={password}
            onChangeText={setPassword}
            onBlur={() => setTouched(true)}
            accessibilityLabel="Password"
          />
          {passwordError ? <Text style={styles.authFieldError}>{passwordError}</Text> : null}
          <PrimaryButton
            label={busy ? 'Working...' : mode === 'register' ? 'Create account' : 'Sign in'}
            icon={mode === 'register' ? UserPlus : ShieldCheck}
            disabled={busy || (touched && !formValid)}
            onPress={submit}
          />
          {appleAvailable ? (
            <>
              <View style={styles.authDivider}>
                <View style={styles.authDividerLine} />
                <Text style={styles.authDividerText}>or</Text>
                <View style={styles.authDividerLine} />
              </View>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={14}
                style={styles.appleButton}
                onPress={signInWithApple}
              />
            </>
          ) : null}
          <Pressable
            style={styles.authModeToggle}
            onPress={() => {
              setMode((m) => (m === 'register' ? 'login' : 'register'));
              setTouched(false);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.authModeToggleText}>
              {mode === 'register' ? 'Already have an account? ' : 'New to Zen-Finance? '}
              <Text style={styles.authModeToggleLink}>{mode === 'register' ? 'Sign in' : 'Create account'}</Text>
            </Text>
          </Pressable>
          {mode === 'login' ? (
            <Pressable
              style={styles.authForgotLink}
              onPress={() => {
                setReset('request');
                setTouched(false);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.authModeToggleLink}>Forgot password?</Text>
            </Pressable>
          ) : null}
          <Text style={styles.disclosureV2}>Educational only. Zen-Finance does not provide investment, tax, or legal advice.</Text>
        </View>
        )}

        <View style={styles.demoPanel}>
          <Text style={styles.demoLabel}>Try a money brief</Text>
          <TextInput
            value={transaction}
            onChangeText={setTransaction}
            placeholder='"I spent $186 dining out this week"'
            placeholderTextColor={theme.muted}
            style={styles.demoInput}
          />
          <Pressable style={styles.demoButton} onPress={generateBrief}>
            <Sparkles color="#fff" size={16} />
            <Text style={styles.demoButtonText}>Generate my brief</Text>
          </Pressable>
        </View>

        <View style={styles.generatedBrief}>
          <View style={styles.generatedCheck}>
            <CheckCircle2 color="#fff" size={28} />
          </View>
          <View style={styles.flexShrink}>
            <Text style={styles.generatedTitle}>This week's action:</Text>
            <Text style={styles.generatedBody}>{brief.action}</Text>
            <Text style={styles.generatedImpact}>{brief.impact}</Text>
          </View>
        </View>

        <View style={styles.authProofGrid}>
          <View style={styles.authProofCard}>
            <Text style={styles.authProofKicker}>Keeps you on pace</Text>
            <Text style={styles.authProofTitle}>Dining out is running hot</Text>
            <Text style={styles.authProofBody}>You've spent $186 this week. Skipping two takeout orders keeps your trip goal on track.</Text>
          </View>
          <View style={styles.authProofCard}>
            <Text style={styles.authProofKicker}>Potential save</Text>
            <Text style={styles.authProofTitle}>Subscription got pricier</Text>
            <Text style={styles.authProofBody}>A recurring charge moved from $11.99 to $16.99. The coach flags it before it becomes normal.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.centerGrow}>
      <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
        <CloudOff color={theme.accent} size={34} />
      </View>
      <Text style={[styles.panelTitle, styles.loadErrorTitle, { color: theme.ink }]}>We couldn't load your money brief</Text>
      <Text style={[styles.panelBody, styles.loadErrorBody, { color: theme.muted }]}>{message}</Text>
      <PrimaryButton label="Try again" icon={RotateCcw} onPress={onRetry} />
    </View>
  );
}

function ProductShell() {
  const theme = useTheme();
  const home = useAppStore((s) => s.home);
  const setHome = useAppStore((s) => s.setHome);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPrefs);
  const [tab, setTab] = useReducerState<TabKey>('brief');
  const [settingsSection, setSettingsSection] = useReducerState<SettingsSection>('account');
  const [accountProfile, setAccountProfile] = useReducerState<AccountProfileView | null>(null);
  const [coachInitialQuestion, setCoachInitialQuestion] = useReducerState('');
  const [refreshing, setRefreshing] = useReducerState(false);
  const [loadError, setLoadError] = useReducerState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const nextHome = await requestApi<MobileHomeSummaryView>('/api/mobile/home');
      setHome(nextHome);
      setLoadError(null);
      void requestApi<AccountProfileView>('/api/me')
        .then(setAccountProfile)
        .catch((err) => Sentry.captureException(err));
      void requestApi<NotificationPreferencesView>('/api/notifications/preferences')
        .then(setNotificationPrefs)
        .catch((err) => Sentry.captureException(err));
    } catch (err) {
      Sentry.captureException(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setLoadError(message);
      // With data already on screen, surface a non-blocking alert but keep the
      // last-known home visible. On first load there's nothing to keep, so the
      // inline error state below takes over instead of an endless spinner.
      if (useAppStore.getState().home) {
        Alert.alert('Could not refresh', message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [setHome, setNotificationPrefs]);

  // Pull-to-refresh on the home brief: force a fresh Coach's Insight instead
  // of just re-reading whatever's cached (the brief otherwise only
  // regenerates once ever for first-look, then weekly on a Monday cron — see
  // /api/insights/refresh). Rate-limited server-side, so a 429 here just
  // means the user already refreshed recently; fall through to a plain
  // refresh so the pull still feels like it did something.
  const refreshInsight = useCallback(async () => {
    setRefreshing(true);
    try {
      await requestApi('/api/insights/refresh', { method: 'POST' });
    } catch (err) {
      if (!(err instanceof ApiRequestError && (err.status === 429 || err.status === 404))) {
        Sentry.captureException(err);
      }
    }
    await refresh();
  }, [refresh]);

  const openSettings = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    setTab('settings');
  }, []);

  const navigateFromProfile = useCallback((destination: ProfileDestination) => {
    if (destination.kind === 'settings') {
      openSettings(destination.section);
      return;
    }
    setTab(destination.tab);
  }, [openSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep-link notification taps to the right tab. The server sends a
  // `data.tab` hint (e.g. weekly-brief pushes carry { tab: 'brief' }); route
  // both foreground taps and a cold start launched from a notification.
  useEffect(() => {
    const routeFromData = (data: unknown) => {
      const tab = (data as { tab?: string } | undefined)?.tab;
      if (tab && ALL_TABS.has(tab as TabKey)) setTab(tab as TabKey);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeFromData(response.notification.request.content.data);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeFromData(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, []);

  const content = useMemo(() => {
    if (!home) {
      if (loadError && !refreshing) {
        return <HomeLoadError message={loadError} onRetry={refresh} />;
      }
      return (
        <View style={styles.centerGrow}>
          <ActivityIndicator color={theme.accent} />
        </View>
      );
    }
    const hasLinkedItems = home.items.length > 0;
    if (tab === 'brief') {
      return hasLinkedItems ? <BriefScreen home={home} onRefresh={refreshInsight} refreshing={refreshing} onNavigate={setTab} /> : <LinkingScreen onLinked={refresh} onBudget={() => setTab('budget')} />;
    }
    if (PREMIUM_TABS.has(tab) && !home.billing.isPremium) {
      return <PaywallScreen billing={home.billing} home={home} source={tab} onChanged={refresh} />;
    }
    if (tab === 'coach') return <CoachScreen initialQuestion={coachInitialQuestion} />;
    if (tab === 'transactions') return <TransactionsScreen home={home} onBack={() => setTab('brief')} onProfile={() => setTab('profile')} onConnect={() => setTab('link')} onBudget={() => setTab('budget')} onRefresh={refresh} />;
    if (tab === 'link') return <LinkingScreen onLinked={() => { void refresh(); setTab('transactions'); }} onBack={() => openSettings('banks')} onBudget={() => setTab('budget')} />;
    if (tab === 'profile') return <ZenProfileScreen accountProfile={accountProfile} billing={home.billing} score={home.zenScore.score} onNavigate={navigateFromProfile} />;
    if (tab === 'budget') return <SmartBudgetingScreen home={home} onGoals={() => setTab('goals')} />;
    if (tab === 'score') {
      return (
        <ZenScoreDetailsScreen
          home={home}
          refreshing={refreshing}
          onBack={() => setTab('profile')}
          onSettings={() => openSettings('account')}
          onRefresh={refresh}
          onNavigate={(destination) => setTab(destination)}
          onAskCoach={(question) => {
            setCoachInitialQuestion(question);
            setTab('coach');
          }}
        />
      );
    }
    if (tab === 'goals') return <GoalsScreen goals={home.goals} billing={home.billing} onChanged={refresh} />;
    if (tab === 'subs') return <SubscriptionsScreen audit={home.subscriptionAudit} onChanged={refresh} />;
    if (tab === 'wins') return <WinsScreen wins={home.moneyWins} moneyPhysical={home.moneyPhysical} billing={home.billing} anomalies={home.openAnomalies} onChanged={refresh} />;
    return <SettingsScreen accountProfile={accountProfile} section={settingsSection} items={home.items} billing={home.billing} onBack={() => setTab('profile')} onChanged={refresh} onNavigate={setTab} />;
  }, [accountProfile, coachInitialQuestion, home, loadError, navigateFromProfile, openSettings, refresh, refreshInsight, refreshing, settingsSection, tab, theme.accent]);

  const isZenRoute = new Set<TabKey>(['brief', 'coach', 'transactions', 'profile', 'goals', 'budget', 'score', 'settings', 'link']).has(tab);

  return (
    <SafeAreaView style={[styles.appScreen, { backgroundColor: theme.bg }]}>
      <StatusBar style="light" />
      <ZenBackdrop />
      <View style={styles.zenFrame}>
        {!isZenRoute ? (
          <View style={styles.topBar}>
            <View style={styles.flexShrink}>
              <View style={styles.appTitleRow}>
                <View style={[styles.tinyLogo, { backgroundColor: theme.accentSoft }]}>
                  <Sparkles color={theme.accent} size={16} />
                </View>
                <Text style={[styles.appTitle, { color: theme.ink }]}>Zen-Finance Coach</Text>
              </View>
              <Text style={[styles.appSub, { color: theme.muted }]}>
                {home && home.items.length > 0 ? latestSyncLabel(home.items) : 'Zen-Finance money cockpit'}
              </Text>
            </View>
            <Pressable accessibilityLabel="Refresh dashboard" style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]} onPress={refresh}>
              {refreshing ? <ActivityIndicator color={theme.accent} /> : <RefreshCcw color={theme.accent} size={19} />}
            </Pressable>
          </View>
        ) : null}
        {home && !isZenRoute ? (
          <View style={styles.shellRail}>
            <ShellCoachConsole home={home} onAsk={() => setTab('coach')} />
          </View>
        ) : null}
        <View style={styles.content}>{content}</View>
        {home ? <TabBar active={tab === 'settings' ? 'profile' : tab === 'link' ? 'transactions' : tab} onChange={setTab} isPremium={home.billing.isPremium} /> : null}
      </View>
    </SafeAreaView>
  );
}

function ShellCoachConsole({ home, onAsk }: { home: MobileHomeSummaryView; onAsk: () => void }) {
  const theme = useTheme();
  const brief = home.weeklyBrief ?? home.firstLook;
  const totalWins = home.moneyWins.verifiedTotalCents + home.moneyWins.estimatedTotalCents;
  const nextAction = brief?.action.description ?? (home.items.length > 0 ? 'Ask the coach what changed in your spending.' : 'Link your first account to unlock a real money brief.');

  return (
    <View style={[styles.coachConsole, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.consoleHeaderRow}>
        <View style={styles.flexShrink}>
          <Text style={[styles.consoleActionKicker, { color: theme.accent }]}>Today's move</Text>
          <Text style={[styles.consoleActionText, { color: theme.ink }]} numberOfLines={2}>{nextAction}</Text>
        </View>
        <Pressable style={[styles.consoleAskPill, { backgroundColor: theme.accent }]} onPress={onAsk}>
          <MessageCircle color="#fff" size={16} />
          <Text style={styles.consoleAskText}>Ask</Text>
        </Pressable>
      </View>
      <View style={styles.consoleStatusRow}>
        <View style={[styles.consoleChip, { borderColor: theme.border, backgroundColor: theme.bg }]}>
          <Landmark color={theme.ink} size={14} />
          <Text style={[styles.consoleChipText, { color: theme.ink }]}>{home.items.length} bank{home.items.length === 1 ? '' : 's'} linked</Text>
          <View style={[styles.consoleDot, { backgroundColor: home.items.length > 0 ? theme.success : theme.gold }]} />
        </View>
        <View style={[styles.consoleChip, { borderColor: theme.border, backgroundColor: theme.bg }]}>
          <RefreshCcw color={theme.ink} size={14} />
          <Text style={[styles.consoleChipText, { color: theme.ink }]}>{home.transactionCount} txns</Text>
        </View>
        <View style={[styles.consoleChip, { borderColor: theme.border, backgroundColor: theme.bg }]}>
          <CircleDollarSign color={theme.ink} size={14} />
          <Text style={[styles.consoleChipText, { color: theme.ink }]}>{home.billing.isPremium ? usd(totalWins, true) : 'Free'}</Text>
        </View>
      </View>
    </View>
  );
}

function LinkingScreen({ onLinked, onBack, onBudget }: { onLinked: () => void; onBack?: () => void; onBudget: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useReducerState(false);
  const [bankQuery, setBankQuery] = useReducerState('');
  const bankNames = ['Chase', 'Wells Fargo', 'Bank of America', 'Citibank', 'Capital One', 'US Bank'];
  const filteredBanks = bankQuery.trim()
    ? bankNames.filter((name) => name.toLowerCase().includes(bankQuery.trim().toLowerCase()))
    : bankNames;

  async function linkBank() {
    setBusy(true);
    try {
      const { linkToken } = await requestApi<{ linkToken: string }>('/api/link/token', { method: 'POST' });
      const session = await createPlaidLinkSession({
        token: linkToken,
        onSuccess: async (success) => {
          try {
            await requestApi('/api/link/exchange', {
              method: 'POST',
              body: JSON.stringify({
                publicToken: success.publicToken,
                institutionName: success.metadata.institution?.name,
              }),
            });
            await requestApi('/api/app-events', {
              method: 'POST',
              body: JSON.stringify({ name: 'onboarding:linked_bank', properties: { institution: success.metadata.institution?.name } }),
            }).catch(() => {});
            onLinked();
          } catch (err) {
            Sentry.captureException(err);
            Alert.alert('Bank connection failed', err instanceof Error ? err.message : 'Unable to finish linking your bank.');
          } finally {
            setBusy(false);
          }
        },
        onExit: (linkExit) => {
          setBusy(false);
          if (linkExit?.error) {
            Sentry.captureException(new Error(`Plaid Link exited: ${linkExit.error.errorCode ?? linkExit.error.errorType ?? 'unknown'}`), {
              extra: { linkExit },
            });
            Alert.alert(
              'Bank connection failed',
              linkExit.error.errorMessage || linkExit.error.displayMessage || 'Unable to finish linking your bank. Please try again.',
            );
          }
        },
        onEvent: () => {},
      });
      await session.open();
    } catch (err) {
      Alert.alert('Link failed', err instanceof Error ? err.message : 'Unknown error');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsDetailHeader}>
        {onBack ? (
          <Pressable style={styles.settingsBackButton} accessibilityLabel="Back to linked banks" onPress={onBack}>
            <ChevronLeft color={theme.ink} size={22} />
          </Pressable>
        ) : null}
        <View style={styles.flexShrink}>
          <Text style={styles.zenPageTitle}>Connect Bank</Text>
          <Text style={styles.zenPageSubtitle}>Link securely in three calm steps</Text>
        </View>
      </View>
      <View style={styles.connectSteps}>{['Select Bank', 'Verify', 'Sync'].map((step, index) => <View key={step} style={styles.connectStep}><View style={[styles.connectStepDot, index === 0 ? styles.connectStepActive : null]}><Text style={styles.connectStepNumber}>{index + 1}</Text></View><Text style={styles.connectStepText}>{step}</Text></View>)}</View>
      <SectionBand>
        <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
          <Landmark color={theme.accent} size={38} />
        </View>
        <Text style={[styles.panelKicker, { color: theme.accent }]}>Read-only setup</Text>
        <Text style={[styles.panelTitle, { color: theme.ink }]}>Link your first account so the coach can read the room.</Text>
        <Text style={[styles.panelBody, { color: theme.muted }]}>
          Plaid connects read-only bank data. Tokens stay on the server, and you can disconnect or delete everything from settings.
        </Text>
        <PrimaryButton label={busy ? 'Opening Plaid...' : 'Link a bank'} icon={Landmark} disabled={busy} onPress={linkBank} />
      </SectionBand>
      <Text style={styles.zenSectionLabel}>POPULAR BANKS</Text>
      <View style={[styles.bankSearchBar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <MaterialSymbol name="search" size={17} color={theme.muted} />
        <TextInput
          style={[styles.bankSearchInput, { color: theme.ink }]}
          placeholder="Search for your bank"
          placeholderTextColor={theme.muted}
          value={bankQuery}
          onChangeText={setBankQuery}
        />
      </View>
      <View style={styles.bankGrid}>{filteredBanks.map((name) => <Pressable key={name} style={styles.bankTile} onPress={linkBank}><Landmark color={theme.accent} size={18} /><Text style={styles.bankTileText}>{name}</Text></Pressable>)}</View>
      <View style={styles.securityBanner}>
        <MaterialSymbol name="lock" size={16} color={theme.muted} />
        <Text style={styles.securityBannerText}>Your data is encrypted and private. We never store your login credentials.</Text>
      </View>
      <ZenGlass style={styles.budgetEntryCard}>
        <View style={styles.budgetEntryIcon}><CircleDollarSign color={theme.violet} size={18} /></View>
        <View style={styles.flexShrink}><Text style={styles.budgetEntryTitle}>Preview Smart Budgeting</Text><Text style={styles.budgetEntryBody}>Explore the calm spending view before linking an account.</Text></View>
        <Pressable accessibilityLabel="Open Smart Budgeting" style={styles.budgetEntryButton} onPress={onBudget}><ChevronRight color="#0B0E14" size={16} /></Pressable>
      </ZenGlass>
      <StatusRail>
        <MoneyMetric label="Access" value="Read-only" icon={ShieldCheck} />
        <MoneyMetric label="Coach" value="Briefs" icon={Sparkles} />
        <MoneyMetric label="Control" value="Delete" icon={Trash2} />
      </StatusRail>
      <SectionHeader title="What unlocks next" />
      <ActionRow icon={Sparkles} title="First look brief" detail="A concise read on your actual recent spending." />
      <ActionRow icon={Target} title="Goal pacing" detail="A weekly action tied to a savings target." />
      <ActionRow icon={CreditCard} title="Recurring audit" detail="A calm list of charges worth reviewing." />
    </ScrollView>
  );
}

function BriefScreen({
  home,
  onRefresh,
  refreshing,
  onNavigate,
}: {
  home: MobileHomeSummaryView;
  onRefresh: () => void;
  refreshing: boolean;
  onNavigate: (tab: TabKey) => void;
}) {
  const theme = useTheme();
  const brief = home.weeklyBrief ?? home.firstLook;
  const [voiceBrief, setVoiceBrief] = useReducerState<VoiceBriefView | null>(null);
  const [voiceBusy, setVoiceBusy] = useReducerState(false);
  const [speaking, setSpeaking] = useReducerState(false);

  const loadVoiceBrief = useCallback(async () => {
    if (!brief || !home.billing.isPremium) {
      setVoiceBrief(null);
      return;
    }
    setVoiceBusy(true);
    try {
      setVoiceBrief(await requestApi<VoiceBriefView>('/api/voice-brief/latest'));
    } catch {
      setVoiceBrief(null);
    } finally {
      setVoiceBusy(false);
    }
  }, [brief?.id, home.billing.isPremium]);

  useEffect(() => {
    void loadVoiceBrief();
    return () => {
      void Speech.stop();
    };
  }, [loadVoiceBrief]);

  async function playVoiceBrief() {
    if (!voiceBrief) return;
    await Speech.stop();
    setSpeaking(true);
    await requestApi(`/api/voice-briefs/${voiceBrief.id}/events`, {
      method: 'POST',
      body: JSON.stringify({ event: 'started' }),
    }).catch(() => {});
    Speech.speak(voiceBrief.script, {
      language: 'en-US',
      rate: 0.92,
      pitch: 1,
      onDone: () => {
        setSpeaking(false);
        void requestApi(`/api/voice-briefs/${voiceBrief.id}/events`, {
          method: 'POST',
          body: JSON.stringify({ event: 'completed', positionSeconds: voiceBrief.durationSeconds }),
        }).catch(() => {});
      },
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  async function stopVoiceBrief() {
    await Speech.stop();
    setSpeaking(false);
  }

  const [moveReviewed, setMoveReviewed] = useReducerState(false);
  async function reviewMove() {
    if (!brief) return;
    setMoveReviewed(true);
    await requestApi(`/api/insights/${brief.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating: 'up' }),
    }).catch(() => {});
  }

  return (
    <ScrollView
      contentContainerStyle={styles.zenHomeScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.zenHomeHeader}>
        <View style={styles.appTitleRow}>
          <View style={styles.zenLotusMark}>
            <ZenLotus size={24} />
          </View>
          <Text style={styles.zenBrand}>Zen-Finance</Text>
        </View>
        <Pressable style={styles.zenHeaderAction} onPress={onRefresh} accessibilityLabel="Refresh home">
          {refreshing ? <ActivityIndicator color={theme.accent} size="small" /> : <RefreshCcw color={theme.muted} size={17} />}
        </Pressable>
      </View>
      <ZenScorePill score={home.zenScore.score} />
      {brief ? (
        <MoneyBriefHero
          home={home}
          brief={brief}
          voiceBrief={voiceBrief}
          voiceBusy={voiceBusy}
          speaking={speaking}
          onPlayVoice={playVoiceBrief}
          onStopVoice={stopVoiceBrief}
          onViewSwap={() => onNavigate('budget')}
        />
      ) : (
        <EmptyMini
          title={home.transactionCount === 0 ? 'Reading your accounts' : 'Your first brief is warming up'}
          copy={
            home.transactionCount === 0
              ? 'Syncing your transactions now — pull down to refresh in a moment.'
              : 'Your coaching brief is being prepared. Pull down to refresh.'
          }
        />
      )}
      <StatusRail>
        <View style={styles.zenStatCard}>
          <Text style={styles.zenStatCardLabel}>Recent Activity:</Text>
          <Text style={styles.zenStatCardBody} numberOfLines={2}>
            {home.recentTransactions.length > 0
              ? home.recentTransactions
                  .slice(0, 3)
                  .map((txn) => txn.merchantClean ?? txn.merchantName ?? txn.name)
                  .join(', ')
              : 'No activity yet'}
          </Text>
        </View>
        <View style={styles.zenStatCard}>
          <Text style={styles.zenStatCardLabel}>Savings Goal:</Text>
          <Text style={styles.zenStatCardBody}>
            {home.goals[0] ? `${home.goals[0].name} (${Math.round(home.goals[0].pacing.progressRatio * 100)}%)` : 'Set your first goal'}
          </Text>
        </View>
      </StatusRail>
      <View style={styles.zenLinkGrid}>
        <Pressable style={styles.zenLinkCard} onPress={() => onNavigate('goals')}>
          <Target color={theme.accent} size={18} />
          <Text style={styles.zenLinkTitle}>Savings Goals</Text>
          <Text style={styles.zenLinkMeta}>Your path to Zen</Text>
        </Pressable>
        <Pressable style={styles.zenLinkCard} onPress={() => onNavigate('budget')}>
          <CircleDollarSign color={theme.violet} size={18} />
          <Text style={styles.zenLinkTitle}>Smart Budgeting</Text>
          <Text style={styles.zenLinkMeta}>Balance your flow</Text>
        </Pressable>
      </View>
      <SectionHeader title="This Week" />
      <StatusRail>
        <MoneyMetric label="Saved" value={usd(home.moneyWins.verifiedTotalCents + home.moneyWins.estimatedTotalCents, true)} icon={CircleDollarSign} />
        <MoneyMetric label="At risk" value={String(home.openAnomalies.length)} icon={Bell} />
        <MoneyMetric label="Recurring" value={usd(home.subscriptionAudit.totalMonthlyCents, true)} icon={CreditCard} />
      </StatusRail>
      <SectionHeader title="Next Best Actions" />
      {brief ? (
        <ActionRow
          icon={CheckCircle2}
          title={moveReviewed ? 'Move reviewed' : 'Review my move'}
          detail={brief.action.description}
          onPress={moveReviewed ? undefined : reviewMove}
        />
      ) : null}
      <ActionRow
        icon={Target}
        title={home.goals[0]?.name ?? 'Create one savings goal'}
        detail={home.goals[0] ? `${usd(home.goals[0].pacing.remainingAmountCents, true)} remaining` : 'Give the coach a target to pace against'}
        onPress={() => onNavigate('goals')}
      />
      <ActionRow
        icon={CreditCard}
        title="Subscription audit"
        detail={`${usd(home.subscriptionAudit.cancelCandidateMonthlyCents, true)}/mo can be reviewed now`}
        onPress={() => onNavigate('subs')}
      />
      <ActionRow
        icon={Bell}
        title="Open alerts"
        detail={`${home.openAnomalies.length} charge${home.openAnomalies.length === 1 ? '' : 's'} need a decision`}
        onPress={() => onNavigate('wins')}
      />
      <SectionHeader title="Recent Money Movement" />
      {home.recentTransactions.slice(0, 6).map((txn) => {
        const category = formatActivityCategory(txn);
        const { icon: iconName, color, backgroundColor } = activityIconForCategory(category);
        const { moneyIn, label: amountLabel } = moneyMovementDisplay(txn.amountCents, (amount) => usd(amount));
        const amountColor = moneyIn ? theme.accent : '#FF6B99';
        const merchant = txn.merchantClean ?? txn.merchantName ?? txn.name;
        const date = dateLabel(txn.postedDate);
        return (
          <ZenGlass key={txn.id} style={styles.activityTile}>
            <View style={[styles.activityIcon, { backgroundColor, borderColor: `${color}40` }]}>
              <MaterialSymbol name={iconName} color={color} size={20} />
            </View>
            <View style={styles.activityCopy}>
              <Text style={styles.activityTitle}>{category}</Text>
              <Text style={styles.activityMerchant}>{merchant}</Text>
              <Text style={styles.activityDate}>{date}</Text>
            </View>
            <Text style={[styles.activityAmount, { color: amountColor }]}>{amountLabel}</Text>
          </ZenGlass>
        );
      })}
      <SecondaryButton label={refreshing ? 'Refreshing...' : 'Refresh'} icon={RefreshCcw} onPress={onRefresh} />
    </ScrollView>
  );
}

function MetricStrip({ home }: { home: MobileHomeSummaryView }) {
  const audit = home.subscriptionAudit;
  return (
    <StatusRail>
      <MoneyMetric label="Wins" value={usd(home.moneyWins.verifiedTotalCents + home.moneyWins.estimatedTotalCents, true)} icon={CircleDollarSign} />
      <MoneyMetric label="Goals" value={String(home.goals.length)} icon={Target} />
      <MoneyMetric label="Subs" value={usd(audit.totalMonthlyCents, true)} icon={CreditCard} />
    </StatusRail>
  );
}

function SubscriptionMetricStrip({ audit }: { audit: SubscriptionAuditView }) {
  return (
    <StatusRail>
      <MoneyMetric label="Monthly" value={usd(audit.totalMonthlyCents, true)} icon={CreditCard} />
      <MoneyMetric label="Candidates" value={String(audit.cancelCandidateCount)} icon={Target} />
      <MoneyMetric label="Potential" value={usd(audit.cancelCandidateMonthlyCents, true)} icon={CircleDollarSign} />
    </StatusRail>
  );
}

function MoneyBriefHero({
  home,
  brief,
  voiceBrief,
  voiceBusy,
  speaking,
  onPlayVoice,
  onStopVoice,
  onViewSwap,
}: {
  home: MobileHomeSummaryView;
  brief: InsightView;
  voiceBrief: VoiceBriefView | null;
  voiceBusy: boolean;
  speaking: boolean;
  onPlayVoice: () => void;
  onStopVoice: () => void;
  onViewSwap: () => void;
}) {
  const theme = useTheme();
  const impact = brief.action.estimatedImpactCents ? usd(brief.action.estimatedImpactCents, true) : '1 move';

  async function feedback(rating: 'up' | 'down') {
    await requestApi(`/api/insights/${brief.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }).catch((err) => Alert.alert('Feedback failed', err instanceof Error ? err.message : 'Unknown error'));
  }

  return (
    <ZenGlass style={styles.zenInsightCard}>
      <View style={styles.zenInsightHeader}>
        <View style={styles.zenInsightIcon}>
          <Sparkles color={theme.accent} size={18} />
        </View>
        <Text style={styles.zenInsightKicker}>AI COACH</Text>
        <View style={styles.flexShrink} />
        <Text style={styles.zenImpact}>{impact}</Text>
      </View>
      <Text style={styles.zenInsightTitle}>Your Coach's Insight</Text>
      <Text style={styles.zenInsightBody}>{brief.body}</Text>
      <SecondaryButton label="View Swap" accent onPress={onViewSwap} />
      <View style={styles.zenInsightFooter}>
        <Text style={styles.zenEvidence}>{home.transactionCount} transactions · {brief.headline}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={home.billing.isPremium && voiceBrief ? 'Play voice brief' : 'Mark insight helpful'} hitSlop={12} onPress={home.billing.isPremium && voiceBrief ? onPlayVoice : () => feedback('up')}>
          <Volume2 color={home.billing.isPremium ? theme.accent : theme.muted} size={17} />
        </Pressable>
      </View>
      {home.billing.isPremium && voiceBrief ? (
        <View style={styles.zenVoiceRow}>
          <Text style={styles.zenDailyMeta}>{speaking ? 'Playing voice brief' : voiceBusy ? 'Preparing audio summary...' : `${Math.round(voiceBrief.durationSeconds / 6) / 10} min audio summary`}</Text>
          {speaking ? <Pressable accessibilityRole="button" accessibilityLabel="Stop voice brief" hitSlop={12} onPress={onStopVoice}><Square color={theme.accent} size={16} /></Pressable> : null}
        </View>
      ) : null}
    </ZenGlass>
  );
}

function accountKindLabel(account: LinkedAccount): string {
  const subtype = account.subtype?.toLowerCase() ?? '';
  const type = account.type.toLowerCase();
  if (type === 'credit' || subtype.includes('credit')) return 'Credit';
  if (subtype.includes('savings') || subtype.includes('saving')) return 'Savings';
  if (subtype.includes('checking') || subtype.includes('check') || type === 'depository' || type === 'cash') return 'Bank';
  return 'Account';
}

function accountKindIcon(kind: string): MaterialSymbolName {
  switch (kind) {
    case 'Credit':
      return 'credit_card';
    case 'Savings':
      return 'savings';
    default:
      return 'account_balance';
  }
}

// Title-cases a raw enum/category code so values like "RIDESHARE_AND_TAXI"
// or "no_deadline" read as "Rideshare And Taxi" / "No Deadline" instead of
// shouting or leaking snake_case into the UI.
function titleCaseFromCode(raw: string): string {
  return raw
    .replace(/_+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatActivityCategory(txn: EnrichedTransactionView): string {
  const text = `${txn.category ?? ''} ${txn.merchantClean ?? txn.merchantName ?? txn.name}`.toLowerCase();
  if (text.includes('invest') || text.includes('vanguard') || text.includes('fidelity') || text.includes('robinhood')) return 'Growth/Investments';
  if (text.includes('dining') || text.includes('coffee') || text.includes('starbucks') || text.includes('restaurant')) return 'Dining';
  if (text.includes('shop') || text.includes('amazon') || text.includes('retail')) return 'Shopping';
  if (text.includes('util') || text.includes('comcast') || text.includes('electric') || text.includes('water')) return 'Utilities';
  return titleCaseFromCode(txn.category ?? 'General');
}

function activityIconForCategory(category: string): { icon: MaterialSymbolName; color: string; backgroundColor: string } {
  switch (category) {
    case 'Growth/Investments':
      return { icon: 'eco', color: '#75D38F', backgroundColor: '#75D38F24' };
    case 'Dining':
      return { icon: 'local_cafe', color: '#E1AF7F', backgroundColor: '#E1AF7F24' };
    case 'Shopping':
      return { icon: 'shopping_cart', color: '#AE8AEF', backgroundColor: '#AE8AEF24' };
    case 'Utilities':
      return { icon: 'home', color: '#79B8F3', backgroundColor: '#79B8F324' };
    default:
      return { icon: 'account_balance_wallet', color: '#8FD8DA', backgroundColor: '#8FD8DA24' };
  }
}

type TransactionsPageResponse = {
  items: EnrichedTransactionView[];
  total: number;
  page: number;
  pageSize: number;
};

const TRANSACTIONS_PAGE_SIZE = 50;

function TransactionsScreen({ home, onBack, onProfile, onConnect, onBudget, onRefresh }: { home: MobileHomeSummaryView; onBack: () => void; onProfile: () => void; onConnect: () => void; onBudget: () => void; onRefresh: () => Promise<void> }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [refreshingBalances, setRefreshingBalances] = useReducerState(false);
  const activityRequestId = useRef(0);
  const [activityRows, setActivityRows] = useReducerState<EnrichedTransactionView[]>(home.recentTransactions);
  const [activityTotal, setActivityTotal] = useReducerState(home.transactionCount);
  const [activityPage, setActivityPage] = useReducerState(0);
  const [activityLoading, setActivityLoading] = useReducerState(false);
  const [activityError, setActivityError] = useReducerState<string | null>(null);
  const accountCards = home.items.flatMap((item) =>
    item.accounts.map((account, accountIndex) => ({
      item,
      account,
      key: `${item.id}-${account.id}-${accountIndex}`,
    })),
  );
  const displayedCards = accountCards.length > 0 ? accountCards.slice(0, 3) : [{
    item: { id: 0, provider: 'plaid', institutionName: 'Connect a bank', accounts: [], status: 'active', lastSyncedAt: null } as LinkedItem,
    account: { id: 0, name: 'Connect a bank', type: 'depository', subtype: null, mask: null, currentBalanceCents: 0, isoCurrency: 'USD' } as LinkedAccount,
    key: 'placeholder',
  }];

  const loadActivityPage = useCallback(async (nextPage: number, append: boolean) => {
    const requestId = ++activityRequestId.current;
    setActivityLoading(true);
    setActivityError(null);
    try {
      const response = await requestApi<TransactionsPageResponse>(
        `/api/transactions?page=${nextPage}&pageSize=${TRANSACTIONS_PAGE_SIZE}`,
      );
      if (requestId !== activityRequestId.current) return;
      setActivityRows((current) => {
        if (!append) return response.items;
        const merged = new Map(current.map((transaction) => [transaction.id, transaction]));
        for (const transaction of response.items) merged.set(transaction.id, transaction);
        return [...merged.values()];
      });
      setActivityTotal(response.total);
      setActivityPage(response.page);
    } catch (err) {
      if (requestId !== activityRequestId.current) return;
      Sentry.captureException(err);
      setActivityError(err instanceof Error ? err.message : 'Unable to load transactions.');
    } finally {
      if (requestId === activityRequestId.current) setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivityPage(1, false);
    return () => {
      activityRequestId.current += 1;
    };
  }, [home.transactionCount, loadActivityPage]);

  const hasMoreActivity = activityRows.length < activityTotal;
  const loadMoreActivity = () => {
    if (!activityLoading && hasMoreActivity) void loadActivityPage(Math.max(1, activityPage + 1), true);
  };

  async function handleRefresh() {
    setRefreshingBalances(true);
    try {
      await requestApi('/api/accounts/refresh-balances', { method: 'POST' });
    } catch (err) {
      Sentry.captureException(err);
      // Reload stored data even when the live provider balance check fails.
    }
    try {
      await Promise.all([onRefresh(), loadActivityPage(1, false)]);
    } finally {
      setRefreshingBalances(false);
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.transactionsScreenScroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshingBalances || (activityLoading && activityPage <= 1)}
          onRefresh={() => void handleRefresh()}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
    >
      <View style={styles.transactionsHeader}>
        <Pressable style={styles.transactionsHeaderIconButton} onPress={onBack} accessibilityLabel="Back to overview">
          <ChevronLeft color={theme.ink} size={22} />
        </Pressable>
        <Text style={styles.transactionsHeaderTitle}>Accounts & Transactions</Text>
        <Pressable style={styles.transactionsHeaderAvatar} onPress={onProfile} accessibilityLabel="Open profile">
          <UserRound color={theme.accent} size={18} strokeWidth={2} />
        </Pressable>
      </View>
      {home.items.length === 0 ? (
        <ZenGlass style={styles.txnEmptyCta}>
          <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
            <Landmark color={theme.accent} size={30} />
          </View>
          <Text style={styles.txnEmptyTitle}>No accounts linked yet</Text>
          <Text style={styles.txnEmptyBody}>Connect a bank to see balances and real transactions here.</Text>
          <PrimaryButton label="Link a bank" icon={Landmark} onPress={onConnect} />
        </ZenGlass>
      ) : null}
      <Text style={styles.transactionsSectionTitle}>Linked Accounts</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountRail}>
        {displayedCards.map(({ item, account, key }, index) => {
          const kind = accountKindLabel(account);
          const iconName = accountKindIcon(kind);
          const displayName = account.name || item.institutionName || kind;
          const ending = account.mask ? `Ending in ${account.mask}` : item.institutionName ? item.institutionName : 'Connected account';
          const balance = account.currentBalanceCents == null ? '$0.00' : usd(account.currentBalanceCents, true);
          const featured = index === 0;
          return (
            <ZenGlass key={key} style={[styles.accountCard, featured ? styles.accountCardFeatured : null]}>
              <Text style={styles.accountCardEyebrow}>{kind}</Text>
              <View style={[styles.accountCardIcon, featured ? styles.accountCardIconFeatured : null]}>
                <MaterialSymbol name={iconName} color={featured ? theme.accent : theme.ink} size={24} />
              </View>
              <Text style={styles.accountCardName}>{kind}</Text>
              <Text style={styles.accountCardSubtitle}>{displayName}</Text>
              <Text style={styles.accountCardEnding}>{ending}</Text>
              <Text style={styles.accountCardAmount}>{balance}</Text>
            </ZenGlass>
          );
        })}
      </ScrollView>
      <View style={styles.activityHeaderRow}>
        <Text style={styles.transactionsSectionTitle}>Recent Activity</Text>
        {hasMoreActivity ? (
          <Pressable disabled={activityLoading} onPress={loadMoreActivity} accessibilityLabel="Load more activity">
            <Text style={styles.activitySeeAll}>{activityLoading ? 'Loading…' : `Load more · ${activityRows.length}/${activityTotal}`}</Text>
          </Pressable>
        ) : <Text style={styles.activitySeeAll}>{activityTotal} total</Text>}
      </View>
      {activityError ? (
        <Pressable style={styles.transactionsError} onPress={() => void loadActivityPage(1, false)} accessibilityLabel="Retry loading transactions">
          <Text style={styles.transactionsErrorText}>{activityError} Tap to retry.</Text>
        </Pressable>
      ) : null}
      {activityLoading && activityRows.length === 0 ? <ActivityIndicator color={theme.accent} /> : null}
      <View style={styles.transactionList}>
        {activityRows.map((txn) => {
          const category = formatActivityCategory(txn);
          const { icon: iconName, color, backgroundColor } = activityIconForCategory(category);
          const amountColor = txn.amountCents < 0 ? '#FF6B99' : theme.accent;
          const merchant = txn.merchantClean ?? txn.merchantName ?? txn.name;
          const date = dateLabel(txn.postedDate);
          return (
            <ZenGlass key={txn.id} style={styles.activityTile}>
              <View style={[styles.activityIcon, { backgroundColor, borderColor: `${color}40` }]}>
                <MaterialSymbol name={iconName} color={color} size={20} />
              </View>
              <View style={styles.activityCopy}>
                <Text style={styles.activityTitle} numberOfLines={1}>{category}</Text>
                <Text style={styles.activityMerchant}>{merchant}</Text>
                <Text style={styles.activityDate}>{date}</Text>
              </View>
              <Text style={[styles.activityAmount, { color: amountColor }]}>{usd(txn.amountCents)}</Text>
            </ZenGlass>
          );
        })}
      </View>
      {!activityLoading && activityRows.length === 0 ? <Text style={styles.zenEmptyText}>No recent transactions yet.</Text> : null}
      {hasMoreActivity ? (
        <Pressable style={styles.transactionsLoadMore} disabled={activityLoading} onPress={loadMoreActivity} accessibilityLabel="Load more transactions">
          {activityLoading ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={styles.transactionsLoadMoreText}>Load more transactions</Text>}
        </Pressable>
      ) : null}
      <Pressable style={styles.transactionsBudgetLink} onPress={onBudget}>
        <CircleDollarSign color={theme.violet} size={17} />
        <Text style={styles.transactionsBudgetText}>Open Smart Budgeting</Text>
        <ChevronRight color={theme.muted} size={16} />
      </Pressable>
      <PrimaryButton label="Connect another account" icon={Landmark} onPress={onConnect} />
    </ScrollView>
  );
}

function ZenProfileScreen({
  accountProfile,
  billing,
  score,
  onNavigate,
}: {
  accountProfile: AccountProfileView | null;
  billing: BillingStatusView;
  score: number | null;
  onNavigate: (destination: ProfileDestination) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.zenProfileScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}>
        <View>
          <Text style={styles.zenPageTitle}>Profile</Text>
          <Text style={styles.zenPageSubtitle}>Your money space, preferences, and privacy</Text>
        </View>
        <View style={[styles.profilePlanBadge, { borderColor: billing.isPremium ? theme.gold : theme.border }]}>
          <Crown color={billing.isPremium ? theme.gold : theme.muted} size={14} />
          <Text style={[styles.profilePlanBadgeText, { color: billing.isPremium ? theme.gold : theme.muted }]}>
            {billing.isPremium ? 'Coach' : 'Free'}
          </Text>
        </View>
      </View>
      <ZenGlass style={styles.profileIdentityCard}>
        <View style={styles.profileAvatar}><ZenLotus size={54} /></View>
        <View style={styles.profileIdentityCopy}>
          <Text style={styles.profileName} numberOfLines={1}>{accountProfile?.email ?? 'Your ZenFinance account'}</Text>
          <View style={styles.profileRoleRow}>
            <ZenLotus size={13} />
            <Text style={styles.profileRole}>{billing.isPremium ? 'Coach membership active' : 'Finding your balance'}</Text>
          </View>
        </View>
      </ZenGlass>
      <Pressable style={styles.profileScore} onPress={() => onNavigate({ kind: 'tab', tab: 'score' })}>
        <View style={[styles.profileMenuIcon, { backgroundColor: theme.accentSoft }]}><ZenLotus size={20} /></View>
        <View style={styles.profileMenuCopy}>
          <Text style={styles.profileMenuText}>Zen Score</Text>
          <Text style={styles.profileMenuDetail}>See what is shaping your financial balance</Text>
        </View>
        <Text style={styles.profileScoreValue}>{score === null ? '—' : `${score}/100`}</Text>
        <ChevronRight color={theme.muted} size={17} />
      </Pressable>
      {PROFILE_MENU_GROUPS.map((group) => (
        <View key={group.title} style={styles.profileMenuGroup}>
          <Text style={styles.profileSectionLabel}>{group.title.toUpperCase()}</Text>
          <ZenGlass style={styles.profileMenu}>
            {group.items.map((row, index) => (
              <Pressable
                key={row.key}
                accessibilityLabel={`${row.label}. ${row.detail}`}
                style={[styles.profileMenuRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}
                onPress={() => onNavigate(row.destination)}
              >
                <View style={[styles.profileMenuIcon, { backgroundColor: theme.surfaceAlt }]}>
                  <MaterialSymbol name={row.icon as MaterialSymbolName} color={theme.accent} size={18} />
                </View>
                <View style={styles.profileMenuCopy}>
                  <Text style={styles.profileMenuText}>{row.label}</Text>
                  <Text style={styles.profileMenuDetail}>{row.detail}</Text>
                </View>
                <ChevronRight color={theme.muted} size={17} />
              </Pressable>
            ))}
          </ZenGlass>
        </View>
      ))}
      <SecondaryButton label="Sign Out" icon={LogOut} onPress={signOutUser} />
    </ScrollView>
  );
}

function budgetCategoryIcon(category: string): MaterialSymbolName {
  const key = category.toLowerCase();
  if (key.includes('rent') || key.includes('mortgage') || key.includes('util') || key.includes('housing')) return 'home';
  if (key.includes('grocery') || key.includes('groceries') || key.includes('supermarket')) return 'shopping_cart';
  if (key.includes('shop') || key.includes('retail') || key.includes('amazon')) return 'shopping_basket';
  if (key.includes('coffee') || key.includes('cafe')) return 'local_cafe';
  if (key.includes('dining') || key.includes('restaurant') || key.includes('food')) return 'restaurant';
  if (key.includes('game') || key.includes('play') || key.includes('entertain') || key.includes('subscri')) return 'sports_esports';
  if (key.includes('gas') || key.includes('fuel')) return 'local_gas_station';
  if (key.includes('bus') || key.includes('transit')) return 'directions_bus';
  if (key.includes('transport') || key.includes('rideshare') || key.includes('taxi') || key.includes('uber') || key.includes('lyft')) return 'directions_car';
  if (key.includes('gym') || key.includes('fitness')) return 'fitness_center';
  if (key.includes('health') || key.includes('medical') || key.includes('doctor')) return 'medical_services';
  if (key.includes('pet')) return 'pets';
  if (key.includes('school') || key.includes('education') || key.includes('tuition')) return 'school';
  if (key.includes('movie') || key.includes('theater') || key.includes('cinema')) return 'movie';
  if (key.includes('travel') || key.includes('flight') || key.includes('airline')) return 'flight';
  if (key.includes('invest') || key.includes('saving')) return 'savings';
  return 'receipt_long';
}

type BudgetNodeStatus = 'healthy' | 'steady' | 'warning' | 'quiet';

function budgetNodeStatus(ratio: number): BudgetNodeStatus {
  if (ratio >= 0.9) return 'warning';
  if (ratio >= 0.5) return 'steady';
  if (ratio > 0) return 'healthy';
  return 'quiet';
}

const BUDGET_STATUS_COLOR: Record<BudgetNodeStatus, string> = {
  healthy: '#00D2D3',
  steady: '#8E44AD',
  warning: '#F5A623',
  quiet: '#FFFFFF4D',
};

// Matches the Stitch render: two categories float above a soft overlapping
// "flower" of translucent circles, with the total hub nested in the flower
// and the remaining two categories sitting at its lower edges. No connector
// lines in the source — the flower cluster itself implies the relationship.
const BUDGET_HUB = { leftPct: 50, top: 168, size: 168 };
const BUDGET_NODE_SLOTS = [
  { leftPct: 26, top: 20, size: 116 },
  { leftPct: 76, top: 20, size: 106 },
  { leftPct: 18, top: 340, size: 100 },
  { leftPct: 78, top: 330, size: 116 },
];
const BUDGET_GRAPH_HEIGHT = 520;
const BUDGET_FLOWER_PETALS = [
  { leftPct: 50, top: 160, size: 170 },
  { leftPct: 24, top: 230, size: 160 },
  { leftPct: 76, top: 230, size: 160 },
  { leftPct: 32, top: 300, size: 150 },
  { leftPct: 68, top: 300, size: 150 },
  { leftPct: 50, top: 320, size: 170 },
];

function BudgetNodeGraph({
  availableCents,
  categories,
  caps,
}: {
  availableCents: number;
  categories: Array<[string, number]>;
  caps: Record<string, number>;
}) {
  const nodes = categories.slice(0, 4).map(([category, amountCents], index) => {
    const slot = BUDGET_NODE_SLOTS[index];
    const capDollars = caps[category] ?? Math.max(50, Math.round(amountCents / 100));
    const ratio = capDollars > 0 ? amountCents / 100 / capDollars : 0;
    return { category, amountCents, capDollars, ratio, slot, status: budgetNodeStatus(ratio) };
  });

  return (
    <View style={[styles.budgetGraph, { height: BUDGET_GRAPH_HEIGHT }]}>
      {BUDGET_FLOWER_PETALS.map((petal, index) => (
        <View
          key={index}
          style={[
            styles.budgetFlowerPetal,
            {
              left: `${petal.leftPct}%`,
              marginLeft: -petal.size / 2,
              top: petal.top,
              width: petal.size,
              height: petal.size,
              borderRadius: petal.size / 2,
            },
          ]}
        />
      ))}
      <ZenGlass
        style={[
          styles.budgetHubNode,
          {
            left: `${BUDGET_HUB.leftPct}%`,
            marginLeft: -BUDGET_HUB.size / 2,
            top: BUDGET_HUB.top,
            width: BUDGET_HUB.size,
            height: BUDGET_HUB.size,
            borderRadius: BUDGET_HUB.size / 2,
            borderColor: '#00D2D366',
          },
        ]}
      >
        <Text style={styles.budgetHubLabel}>TOTAL</Text>
        <Text style={styles.budgetHubAmount}>{usd(availableCents, true)}</Text>
      </ZenGlass>
      {nodes.map((node) => {
        const color = BUDGET_STATUS_COLOR[node.status];
        const isWarning = node.status === 'warning';
        return (
          <ZenGlass
            key={node.category}
            style={[
              styles.budgetNode,
              {
                left: `${node.slot.leftPct}%`,
                marginLeft: -node.slot.size / 2,
                top: node.slot.top,
                width: node.slot.size,
                height: node.slot.size,
                borderRadius: node.slot.size / 2,
                borderColor: color,
                shadowColor: color,
              },
            ]}
          >
            <MaterialSymbol name={budgetCategoryIcon(node.category)} size={18} color={color} />
            <Text style={styles.budgetNodeName} numberOfLines={1}>{titleCaseFromCode(node.category)}</Text>
            <Text style={[styles.budgetNodeAmount, isWarning ? { color } : null]} numberOfLines={1}>{usd(node.amountCents, true)}</Text>
            {isWarning ? (
              <View style={[styles.budgetNodeTag, { backgroundColor: `${color}33`, borderColor: `${color}80` }]}>
                <Text style={[styles.budgetNodeTagText, { color }]}>HIGH FLOW</Text>
              </View>
            ) : null}
          </ZenGlass>
        );
      })}
    </View>
  );
}

type BudgetConfig = {
  targets: Record<BudgetPeriod, string>;
  period: BudgetPeriod;
  alertsEnabled: boolean;
  categoryCaps: Record<string, number>;
};

const BUDGET_CONFIG_KEY = 'smartBudgetConfigV2';

async function fetchBudgetTransactions(): Promise<EnrichedTransactionView[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const earliest = monthStart < weekStart ? monthStart : weekStart;
  const earliestDate = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
  const collected: EnrichedTransactionView[] = [];
  for (let page = 1; ; page += 1) {
    const response = await requestApi<{ items: EnrichedTransactionView[]; total: number; page: number; pageSize: number }>(
      `/api/transactions?page=${page}&pageSize=200`,
    );
    collected.push(...response.items);
    if (
      response.items.length === 0
      || collected.length >= response.total
      || response.items.some((transaction) => transaction.postedDate < earliestDate)
    ) break;
  }
  return collected;
}

function budgetPlanStatusCopy(status: BudgetPlanView['status']): { label: string; color: string } {
  if (status === 'ready') return { label: 'Balanced plan', color: '#48EFEF' };
  if (status === 'tight') return { label: 'Lean plan', color: '#F5A623' };
  if (status === 'shortfall') return { label: 'Shortfall', color: '#FF8FB3' };
  return { label: 'Income needed', color: '#F5A623' };
}

function budgetPlanMonthLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function SmartBudgetingScreen({ home, onGoals }: { home: MobileHomeSummaryView; onGoals: () => void }) {
  const theme = useTheme();
  const [editing, setEditing] = useReducerState(false);
  const [targets, setTargets] = useReducerState<Record<BudgetPeriod, string>>({ monthly: '', weekly: '' });
  const [draftBudgetTarget, setDraftBudgetTarget] = useReducerState('');
  const [period, setPeriod] = useReducerState<BudgetPeriod>('monthly');
  const [alertsEnabled, setAlertsEnabled] = useReducerState(true);
  const [categoryCaps, setCategoryCaps] = useReducerState<Record<string, number>>({});
  const [capDraftText, setCapDraftText] = useReducerState<Record<string, string>>({});
  const [transactions, setTransactions] = useReducerState<EnrichedTransactionView[]>(home.recentTransactions);
  const [showAiPlanner, setShowAiPlanner] = useReducerState(false);
  const [selectedGoalId, setSelectedGoalId] = useReducerState<number | null>(() => home.goals.find((goal) => goal.status === 'active' && goal.pacing.remainingAmountCents > 0)?.id ?? null);
  const [monthlySavings, setMonthlySavings] = useReducerState('');
  const [budgetPlan, setBudgetPlan] = useReducerState<BudgetPlanView | null>(null);
  const [budgetPlanError, setBudgetPlanError] = useReducerState<string | null>(null);
  const [buildingBudgetPlan, setBuildingBudgetPlan] = useReducerState(false);
  const [showAllBills, setShowAllBills] = useReducerState(false);
  const budgetPlanRequestId = useRef(0);
  const activeGoals = useMemo(() => home.goals.filter((goal) => goal.status === 'active' && goal.pacing.remainingAmountCents > 0), [home.goals]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      SecureStore.getItemAsync(BUDGET_CONFIG_KEY),
      fetchBudgetTransactions(),
    ]).then(([stored, loadedTransactions]) => {
      if (!active) return;
      if (stored) {
        const config = JSON.parse(stored) as BudgetConfig;
        setTargets(config.targets);
        setDraftBudgetTarget(config.targets[config.period]);
        setPeriod(config.period);
        setAlertsEnabled(config.alertsEnabled);
        setCategoryCaps(config.categoryCaps);
      } else {
        setEditing(true);
      }
      setTransactions(loadedTransactions);
    }).catch((err) => {
      if (active) Alert.alert('Budget unavailable', err instanceof Error ? err.message : 'Unable to load your budget.');
    });
    return () => { active = false; };
  }, []);

  const persistBudget = useCallback((next: BudgetConfig) => {
    void SecureStore.setItemAsync(BUDGET_CONFIG_KEY, JSON.stringify(next), DEVICE_BOUND_STORE_OPTIONS).catch(() => {
      Alert.alert('Budget not saved', 'Your device could not securely save these settings.');
    });
  }, []);

  const allCategories = useMemo(() => {
    return budgetCategories(transactions, period);
  }, [period, transactions]);
  const categories = allCategories.slice(0, 5);
  const total = allCategories.reduce((sum, [, amount]) => sum + amount, 0);
  const budgetTarget = editing ? draftBudgetTarget : targets[period];
  const targetCents = Math.max(0, Math.round(Number(budgetTarget.replace(/[$,\s]/g, '')) * 100) || 0);
  const availableCents = Math.max(0, targetCents - total);

  function openEditor() {
    setDraftBudgetTarget(budgetTarget);
    setEditing(true);
  }

  function saveBudget() {
    const next = Number(draftBudgetTarget.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(next) || next <= 0) return;
    const nextTargets = { ...targets, [period]: String(Math.round(next)) };
    setTargets(nextTargets);
    persistBudget({ targets: nextTargets, period, alertsEnabled, categoryCaps });
    setEditing(false);
  }

  function selectPeriod(nextPeriod: BudgetPeriod) {
    setPeriod(nextPeriod);
    setDraftBudgetTarget(targets[nextPeriod]);
    if (!targets[nextPeriod]) setEditing(true);
    persistBudget({ targets, period: nextPeriod, alertsEnabled, categoryCaps });
  }

  function adjustCategoryCap(category: string, amountCents: number, delta: number) {
    setCategoryCaps((current) => {
      const currentCap = current[category] ?? Math.max(50, Math.round(amountCents / 100));
      const next = { ...current, [category]: Math.max(25, currentCap + delta) };
      persistBudget({ targets, period, alertsEnabled, categoryCaps: next });
      return next;
    });
    setCapDraftText((current) => {
      const { [category]: _dropped, ...rest } = current;
      return rest;
    });
  }

  function commitCategoryCapText(category: string, amountCents: number, text: string) {
    const parsed = Math.round(Number(text.replace(/[^0-9]/g, '')));
    const fallback = categoryCaps[category] ?? Math.max(50, Math.round(amountCents / 100));
    const next = Number.isFinite(parsed) && parsed > 0 ? Math.max(25, parsed) : fallback;
    setCategoryCaps((current) => {
      const nextCaps = { ...current, [category]: next };
      persistBudget({ targets, period, alertsEnabled, categoryCaps: nextCaps });
      return nextCaps;
    });
    setCapDraftText((current) => {
      const { [category]: _dropped, ...rest } = current;
      return rest;
    });
  }

  async function buildAiBudgetPlan() {
    const request = buildBudgetPlanRequest(selectedGoalId, monthlySavings);
    if (!request.ok) {
      budgetPlanRequestId.current += 1;
      setBudgetPlanError(request.error);
      return;
    }
    const requestId = ++budgetPlanRequestId.current;
    setBuildingBudgetPlan(true);
    setBudgetPlan(null);
    setBudgetPlanError(null);
    setShowAllBills(false);
    try {
      const plan = await requestApi<BudgetPlanView>('/api/budget/plan', {
        method: 'POST',
        body: JSON.stringify(request.value),
      });
      if (requestId === budgetPlanRequestId.current) setBudgetPlan(plan);
    } catch (error) {
      if (requestId === budgetPlanRequestId.current) {
        setBudgetPlanError(error instanceof Error ? error.message : 'Unable to build your monthly plan.');
      }
    } finally {
      if (requestId === budgetPlanRequestId.current) setBuildingBudgetPlan(false);
    }
  }

  function applyAiBudgetPlan() {
    if (!budgetPlan || !canApplyBudgetPlan(budgetPlan)) return;
    const monthlyTarget = appliedBudgetTarget(budgetPlan);
    const nextTargets = { ...targets, monthly: monthlyTarget };
    const nextCaps = appliedCategoryCaps(budgetPlan);
    setTargets(nextTargets);
    setDraftBudgetTarget(monthlyTarget);
    setPeriod('monthly');
    setCategoryCaps(nextCaps);
    setCapDraftText({});
    persistBudget({ targets: nextTargets, period: 'monthly', alertsEnabled, categoryCaps: nextCaps });
    Alert.alert(
      'Monthly plan applied',
      `Your ${budgetPlanMonthLabel(budgetPlan.planMonth)} spending budget and category caps now reflect ${usd(budgetPlan.goal.plannedSavingsCents, true)} toward ${budgetPlan.goal.name}. No money was moved.`,
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Smart Budgeting</Text><Text style={styles.zenPageSubtitle}>A softer way to see your spending</Text></View><Pressable accessibilityRole="button" accessibilityLabel={editing ? 'Cancel editing budget' : 'Edit budget'} style={styles.zenEditButton} onPress={editing ? () => setEditing(false) : openEditor}><Text style={styles.zenHeaderEdit}>{editing ? 'Cancel' : 'Edit'}</Text></Pressable></View>
      {editing ? <ZenGlass style={styles.budgetEditPanel}><Text style={styles.budgetEditTitle}>{period === 'monthly' ? 'Monthly' : 'Weekly'} budget</Text><Text style={styles.budgetEditBody}>Set the amount you want to keep available after planned spending for this {period === 'monthly' ? 'month' : 'week'}.</Text><TextInput value={draftBudgetTarget} onChangeText={setDraftBudgetTarget} keyboardType="decimal-pad" placeholder={period === 'monthly' ? '$3,000' : '$750'} placeholderTextColor={theme.muted} style={styles.budgetInput} /><View style={styles.budgetEditActions}><SecondaryButton label="Cancel" compact onPress={() => setEditing(false)} /><PrimaryButton label="Save budget" icon={CheckCircle2} compact onPress={saveBudget} /></View></ZenGlass> : null}
      <BudgetNodeGraph availableCents={availableCents} categories={categories} caps={categoryCaps} />
      <ZenGlass style={styles.budgetControls}>
        <View style={styles.budgetControlHeader}><Text style={styles.budgetControlTitle}>Budget Period</Text><Text style={styles.budgetControlMeta}>{period === 'monthly' ? 'Resets monthly' : 'Resets weekly'}</Text></View>
        <View style={styles.budgetSegmented}><Pressable accessibilityRole="button" accessibilityState={{ selected: period === 'monthly' }} style={[styles.budgetSegment, period === 'monthly' ? styles.budgetSegmentActive : null]} onPress={() => selectPeriod('monthly')}><Text style={[styles.budgetSegmentText, period === 'monthly' ? styles.budgetSegmentTextActive : null]}>Monthly</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: period === 'weekly' }} style={[styles.budgetSegment, period === 'weekly' ? styles.budgetSegmentActive : null]} onPress={() => selectPeriod('weekly')}><Text style={[styles.budgetSegmentText, period === 'weekly' ? styles.budgetSegmentTextActive : null]}>Weekly</Text></Pressable></View>
        <View style={styles.budgetToggleRow}><View style={styles.flexShrink}><Text style={styles.budgetToggleTitle}>Mindful alerts</Text><Text style={styles.budgetToggleMeta}>Remember whether budget nudges are enabled</Text></View><Switch value={alertsEnabled} onValueChange={(value) => { setAlertsEnabled(value); persistBudget({ targets, period, alertsEnabled: value, categoryCaps }); }} trackColor={{ false: '#FFFFFF26', true: theme.accent }} thumbColor="#FFFFFF" /></View>
      </ZenGlass>
      <ZenGlass style={[styles.aiBudgetCard, { borderColor: budgetPlan ? `${budgetPlanStatusCopy(budgetPlan.status).color}66` : theme.violet }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showAiPlanner ? 'Collapse AI budget plan' : 'Open AI budget plan'}
          accessibilityState={{ expanded: showAiPlanner }}
          style={styles.aiBudgetHeader}
          onPress={() => setShowAiPlanner((current) => !current)}
        >
          <View style={[styles.aiBudgetIcon, { backgroundColor: theme.violetSoft }]}><Brain color={theme.violet} size={20} /></View>
          <View style={styles.flexShrink}>
            <Text style={styles.aiBudgetKicker}>AI MONTHLY PLAN</Text>
            <Text style={styles.aiBudgetTitle}>Plan around a savings goal</Text>
            <Text style={styles.aiBudgetIntro}>Income − every detected bill − your goal = a budget you can review and apply.</Text>
          </View>
          <ChevronRight color={theme.muted} size={18} style={{ transform: [{ rotate: showAiPlanner ? '90deg' : '0deg' }] }} />
        </Pressable>
        {showAiPlanner ? (
          <View style={styles.aiBudgetBody}>
            {activeGoals.length === 0 ? (
              <View style={styles.aiBudgetEmpty}>
                <Text style={styles.aiBudgetEmptyTitle}>Create a savings goal first</Text>
                <Text style={styles.aiBudgetEmptyBody}>The plan needs a goal so it knows what to protect before recommending spending.</Text>
                <SecondaryButton label="Create savings goal" icon={Target} compact onPress={onGoals} />
              </View>
            ) : (
              <>
                <Text style={styles.aiBudgetFieldLabel}>Savings goal</Text>
                <View style={styles.aiBudgetGoalChips}>
                  {activeGoals.map((goal) => {
                    const selected = selectedGoalId === goal.id;
                    return (
                      <Pressable
                        key={goal.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={[styles.aiBudgetGoalChip, selected ? { borderColor: theme.accent, backgroundColor: theme.accentSoft } : { borderColor: theme.border }]}
                        onPress={() => {
                          budgetPlanRequestId.current += 1;
                          setBuildingBudgetPlan(false);
                          setSelectedGoalId(goal.id);
                          setBudgetPlan(null);
                          setBudgetPlanError(null);
                        }}
                      >
                        <Target color={selected ? theme.accent : theme.muted} size={14} />
                        <View style={styles.flexShrink}>
                          <Text style={[styles.aiBudgetGoalName, { color: selected ? theme.accent : theme.ink }]} numberOfLines={1}>{goal.name}</Text>
                          <Text style={styles.aiBudgetGoalRemaining}>{usd(goal.pacing.remainingAmountCents, true)} remaining</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.aiBudgetFieldLabel}>Save toward it this month</Text>
                <TextInput
                  value={monthlySavings}
                  onChangeText={(value) => {
                    budgetPlanRequestId.current += 1;
                    setBuildingBudgetPlan(false);
                    setMonthlySavings(value);
                    setBudgetPlan(null);
                    setBudgetPlanError(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="$500"
                  placeholderTextColor={theme.muted}
                  style={styles.aiBudgetInput}
                  accessibilityLabel="Savings amount for this month's AI budget plan"
                />
                <View style={styles.aiBudgetPresets}>
                  {['100', '300', '500'].map((amount) => (
                    <Pressable key={amount} style={[styles.aiBudgetPreset, { borderColor: theme.border }]} onPress={() => { budgetPlanRequestId.current += 1; setBuildingBudgetPlan(false); setMonthlySavings(amount); setBudgetPlan(null); setBudgetPlanError(null); }}>
                      <Text style={[styles.aiBudgetPresetText, { color: theme.accent }]}>${amount}</Text>
                    </Pressable>
                  ))}
                </View>
                <PrimaryButton label={buildingBudgetPlan ? 'Building your plan...' : 'Build my monthly plan'} icon={Sparkles} disabled={buildingBudgetPlan} onPress={() => void buildAiBudgetPlan()} />
                <Text style={styles.aiBudgetSafety}>Preview only. Zen uses linked income, recent spending, and every detected recurring bill. No money moves.</Text>
                {budgetPlanError ? <Text style={styles.aiBudgetError}>{budgetPlanError}</Text> : null}
                {budgetPlan ? (
                  <View style={styles.aiBudgetResult}>
                    <View style={styles.aiBudgetResultHeader}>
                      <View>
                        <Text style={styles.aiBudgetResultMonth}>{budgetPlanMonthLabel(budgetPlan.planMonth).toUpperCase()}</Text>
                        <Text style={styles.aiBudgetResultTitle}>{budgetPlan.goal.name}</Text>
                      </View>
                      <View style={[styles.aiBudgetStatus, { borderColor: budgetPlanStatusCopy(budgetPlan.status).color, backgroundColor: `${budgetPlanStatusCopy(budgetPlan.status).color}1F` }]}>
                        <Text style={[styles.aiBudgetStatusText, { color: budgetPlanStatusCopy(budgetPlan.status).color }]}>{budgetPlanStatusCopy(budgetPlan.status).label}</Text>
                      </View>
                    </View>
                    <Text style={styles.aiBudgetExplanation}>{budgetPlan.explanation}</Text>
                    {budgetPlan.goal.requestedSavingsCents > budgetPlan.goal.plannedSavingsCents ? (
                      <Text style={styles.aiBudgetGoalCapNote}>Your input is above the amount remaining on this goal, so the plan protects {usd(budgetPlan.goal.plannedSavingsCents, true)} instead.</Text>
                    ) : null}
                    <View style={styles.aiBudgetLedger}>
                      {[
                        ['Modeled income', budgetPlan.monthlyIncomeCents],
                        [`All ${budgetPlan.dataCoverage.detectedBillCount} bills`, -budgetPlan.recurringBillsTotalCents],
                        [`Save for ${budgetPlan.goal.name}`, -budgetPlan.goal.plannedSavingsCents],
                        ['Recommended spending', budgetPlan.recommendedSpendingCents],
                        [budgetPlan.shortfallCents > 0 ? 'Shortfall' : 'Unassigned buffer', budgetPlan.shortfallCents > 0 ? -budgetPlan.shortfallCents : budgetPlan.bufferCents],
                      ].map(([label, amount], index) => (
                        <View key={String(label)} style={[styles.aiBudgetLedgerRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}>
                          <Text style={styles.aiBudgetLedgerLabel}>{label}</Text>
                          <Text style={[styles.aiBudgetLedgerValue, Number(amount) < 0 ? { color: budgetPlan.shortfallCents > 0 && label === 'Shortfall' ? '#FF8FB3' : theme.muted } : { color: theme.accent }]}>
                            {Number(amount) < 0 ? '−' : ''}{usd(Math.abs(Number(amount)), true)}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {budgetPlan.dataCoverage.detectedBillCount > 0 ? (
                      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllBills }} style={styles.aiBudgetDisclosure} onPress={() => setShowAllBills((current) => !current)}>
                        <View style={styles.flexShrink}>
                          <Text style={styles.aiBudgetDisclosureTitle}>{budgetPlan.dataCoverage.detectedBillCount} detected bills included</Text>
                          <Text style={styles.aiBudgetDisclosureMeta}>{budgetPlan.dataCoverage.allDetectedBillsIncluded ? `Every active recurring charge · ${budgetPlan.dataCoverage.weeksAnalyzed} recent week${budgetPlan.dataCoverage.weeksAnalyzed === 1 ? '' : 's'} analyzed` : 'Review data coverage'}</Text>
                        </View>
                        <Text style={[styles.aiBudgetDisclosureAction, { color: theme.accent }]}>{showAllBills ? 'Hide' : 'Review all'}</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.aiBudgetDisclosure}>
                        <View style={styles.flexShrink}>
                          <Text style={styles.aiBudgetDisclosureTitle}>No recurring bills detected</Text>
                          <Text style={styles.aiBudgetDisclosureMeta}>Sync linked accounts if you expected bills here.</Text>
                        </View>
                      </View>
                    )}
                    {showAllBills && budgetPlan.bills.length > 0 ? (
                      <View style={styles.aiBudgetBillList}>
                        {budgetPlan.bills.map((bill, index) => (
                          <View key={bill.recurringStreamId} style={[styles.aiBudgetBillRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}>
                            <View style={styles.flexShrink}>
                              <Text style={styles.aiBudgetBillName}>{bill.merchantClean}</Text>
                              <Text style={styles.aiBudgetBillMeta}>{bill.cadence}{bill.isAdjustable ? ' · adjustable' : ' · protected'}</Text>
                            </View>
                            <Text style={styles.aiBudgetBillAmount}>{usd(bill.monthlyEquivalentCents, true)}/mo</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {budgetPlan.categories.length > 0 ? (
                      <View style={styles.aiBudgetCategoryList}>
                        <Text style={styles.aiBudgetCategoryHeading}>SUGGESTED CATEGORY CAPS</Text>
                        {budgetPlan.categories.slice(0, 6).map((category) => (
                          <View key={category.category} style={styles.aiBudgetCategoryRow}>
                            <View style={styles.flexShrink}>
                              <Text style={styles.aiBudgetCategoryName}>{category.label}</Text>
                              <Text style={styles.aiBudgetCategoryMeta}>{category.isDiscretionary ? 'Adjustable' : 'Essential'}{category.recurringMonthlyCents > 0 ? ' · includes bills' : ''}</Text>
                            </View>
                            <Text style={styles.aiBudgetCategoryAmount}>{usd(category.recommendedCents, true)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <PrimaryButton
                      label={canApplyBudgetPlan(budgetPlan) ? 'Apply this monthly budget' : budgetPlan.status === 'needs_income' ? 'Income data required' : 'Resolve shortfall first'}
                      icon={CheckCircle2}
                      disabled={!canApplyBudgetPlan(budgetPlan)}
                      onPress={applyAiBudgetPlan}
                    />
                    <Text style={styles.aiBudgetApplyNote}>Applying updates this device's monthly target and category caps only.</Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </ZenGlass>
      <Text style={styles.zenSectionLabel}>CATEGORY CAPS</Text>
      <ZenGlass style={styles.categoryCapsPanel}>
        {categories.map(([category, amount], index) => {
          const cap = categoryCaps[category] ?? Math.max(50, Math.round(amount / 100));
          return (
            <View key={category} style={[styles.categoryCapRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}>
              <View style={styles.flexShrink}>
                <Text style={styles.categoryCapName}>{titleCaseFromCode(category)}</Text>
                <Text style={styles.categoryCapMeta}>Spent {usd(amount, true)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${titleCaseFromCode(category)} cap`}
                style={styles.capButton}
                onPress={() => adjustCategoryCap(category, amount, -50)}
              >
                <Minus color={theme.muted} size={18} />
              </Pressable>
              <View style={styles.categoryCapInputWrap}>
                <Text style={styles.categoryCapDollarSign}>$</Text>
                <TextInput
                  value={capDraftText[category] ?? String(cap)}
                  onChangeText={(text) => setCapDraftText((current) => ({ ...current, [category]: text.replace(/[^0-9]/g, '') }))}
                  onEndEditing={() => commitCategoryCapText(category, amount, capDraftText[category] ?? String(cap))}
                  keyboardType="number-pad"
                  style={styles.categoryCapValue}
                  accessibilityLabel={`${titleCaseFromCode(category)} cap amount`}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase ${titleCaseFromCode(category)} cap`}
                style={styles.capButton}
                onPress={() => adjustCategoryCap(category, amount, 50)}
              >
                <Plus color={theme.accent} size={18} />
              </Pressable>
            </View>
          );
        })}
      </ZenGlass>
      <ZenGlass style={styles.budgetInsight}><Sparkles color={theme.accent} size={18} /><View style={styles.flexShrink}><Text style={styles.budgetInsightTitle}>A gentle nudge</Text><Text style={styles.budgetInsightBody}>Your essentials are steady. Keep one flexible category open for joy.</Text></View></ZenGlass>
    </ScrollView>
  );
}

const SCORE_COMPONENT_ICON: Record<string, IconComponent> = {
  mindful_spending: CircleDollarSign,
  growth_savings: PiggyBank,
  consistency: CheckCircle2,
};
// Match the Stitch render: Mindful = Teal, Growth = Violet, Consistency = Teal.
const SCORE_COMPONENT_TINT: Record<string, keyof typeof midnightZen> = {
  mindful_spending: 'accent',
  growth_savings: 'violet',
  consistency: 'accent',
};

function ScoreRowCard({
  component,
  icon: Icon,
  tint,
  expanded,
  onToggle,
  onAction,
}: {
  component: ZenScoreComponent;
  icon: IconComponent;
  tint: string;
  expanded: boolean;
  onToggle: () => void;
  onAction: () => void;
}) {
  const { label, detail, value } = component;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const guidance = zenScoreGuidance(component);
  return (
    <ZenGlass style={styles.scoreRowCard}>
      <Pressable
        style={styles.scoreRowTop}
        onPress={onToggle}
        accessibilityLabel={`${label}, ${value === null ? 'not enough data' : `${value} out of 100`}`}
        accessibilityHint={expanded ? 'Collapses the next-step guidance' : 'Expands the next-step guidance'}
        accessibilityState={{ expanded }}
      >
        <View style={styles.scoreMetricIcon}><Icon color={tint} size={20} /></View>
        <View style={styles.flexShrink}>
          <Text style={styles.scoreRowName}>{label}</Text>
          <Text style={styles.scoreRowDetail} numberOfLines={2}>{detail}</Text>
        </View>
        <ChevronRight color={tint} size={18} style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }} />
      </Pressable>
      <View
        style={styles.scoreRowBarRow}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${label} progress`}
        accessibilityValue={value === null ? { text: 'Not enough data yet' } : { min: 0, max: 100, now: value }}
      >
        <View style={styles.scoreRowTrack}>
          <View style={[styles.scoreRowFill, { width: `${pct}%`, backgroundColor: tint }]} />
        </View>
        <Text style={styles.scoreRowPct}>{value === null ? '—' : `${value}%`}</Text>
      </View>
      {expanded ? (
        <View style={styles.scoreGuidancePanel}>
          <Text style={[styles.scoreGuidanceKicker, { color: tint }]}>NEXT STEP</Text>
          <Text style={styles.scoreGuidanceTitle}>{guidance.title}</Text>
          <Text style={styles.scoreGuidanceBody}>{guidance.body}</Text>
          <SecondaryButton compact label={guidance.actionLabel} icon={ChevronRight} onPress={onAction} />
        </View>
      ) : null}
    </ZenGlass>
  );
}

function ZenScoreDetailsScreen({
  home,
  refreshing,
  onBack,
  onSettings,
  onRefresh,
  onNavigate,
  onAskCoach,
}: {
  home: MobileHomeSummaryView;
  refreshing: boolean;
  onBack: () => void;
  onSettings: () => void;
  onRefresh: () => Promise<void>;
  onNavigate: (destination: ZenScoreDestination) => void;
  onAskCoach: (question: string) => void;
}) {
  const theme = useTheme();
  const { score, caption, components } = home.zenScore;
  const focus = zenScoreFocus(components);
  const [expandedKey, setExpandedKey] = useReducerState<ZenScoreComponent['key'] | null>(focus?.key ?? null);
  const focusGuidance = focus ? zenScoreGuidance(focus) : null;

  return (
    <ScrollView
      contentContainerStyle={styles.zenScreenScroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
    >
      <View style={styles.scorePageHeader}>
        <Pressable style={styles.scoreHeaderButton} onPress={onBack} accessibilityLabel="Back to profile">
          <ChevronLeft color={theme.ink} size={22} />
        </Pressable>
        <View style={styles.flexShrink}>
          <Text style={styles.zenPageTitle}>Zen Score Details</Text>
          <Text style={styles.zenPageSubtitle}>Your progress, reflected</Text>
        </View>
        <Pressable style={styles.scoreHeaderButton} onPress={onSettings} accessibilityLabel="Open settings">
          <SlidersHorizontal color={theme.muted} size={20} />
        </Pressable>
      </View>
      <View style={styles.scoreHeroV2}>
        <Text style={styles.scoreHeroLabel}>Zen Score</Text>
        <Text style={styles.scoreHeroNumber}>{score ?? '—'}</Text>
        <ZenLotusPhoto variant="score" width={260} />
        <Text style={styles.scoreHeroMeta}>{caption}</Text>
        <Text style={styles.scoreHeroUpdated}>{latestSyncLabel(home.items)}</Text>
      </View>
      {score === null ? (
        <ZenGlass style={styles.scoreBuildingCard}>
          <Text style={styles.scoreGuidanceKicker}>SCORE BUILDING</Text>
          <Text style={styles.scoreGuidanceTitle}>Your score needs real activity</Text>
          <Text style={styles.scoreGuidanceBody}>Connected, categorized transactions unlock Mindful Spending first. Savings activity, goals, and multiple active weeks complete the rest.</Text>
          <PrimaryButton label="Review connected accounts" icon={WalletCards} onPress={() => onNavigate('transactions')} />
        </ZenGlass>
      ) : null}
      <View style={styles.scoreMethodRow}>
        <Text style={styles.zenSectionLabel}>WHAT SHAPES YOUR SCORE</Text>
        <Text style={styles.scoreMethodMeta}>Tap each signal</Text>
      </View>
      <View style={styles.scoreRowStack}>
        {components.map((c) => (
          <ScoreRowCard
            key={c.key}
            component={c}
            icon={SCORE_COMPONENT_ICON[c.key] ?? CircleDollarSign}
            tint={theme[SCORE_COMPONENT_TINT[c.key] ?? 'accent']}
            expanded={expandedKey === c.key}
            onToggle={() => setExpandedKey((current) => current === c.key ? null : c.key)}
            onAction={() => onNavigate(zenScoreGuidance(c).destination)}
          />
        ))}
      </View>
      {focus && focusGuidance ? (
        <ZenGlass style={styles.scoreNextBestCard}>
          <View style={styles.scoreNextBestHeader}>
            <View style={styles.zenInsightIcon}><Target color={theme.accent} size={17} /></View>
            <View style={styles.flexShrink}>
              <Text style={styles.scoreGuidanceKicker}>BEST NEXT FOCUS</Text>
              <Text style={styles.scoreNextBestLabel}>{focus.label}</Text>
            </View>
          </View>
          <Text style={styles.scoreGuidanceTitle}>{focusGuidance.title}</Text>
          <Text style={styles.scoreGuidanceBody}>{focusGuidance.body}</Text>
          <PrimaryButton label={focusGuidance.actionLabel} icon={ChevronRight} onPress={() => onNavigate(focusGuidance.destination)} />
          {home.billing.isPremium ? (
            <SecondaryButton label="Ask Coach about this score" icon={MessageCircle} onPress={() => onAskCoach(zenScoreCoachPrompt(score, focus))} />
          ) : (
            <Text style={styles.scoreCoachNote}>Your next step above is available free. Personalized AI follow-up is included with ZenFinance Coach.</Text>
          )}
        </ZenGlass>
      ) : null}
    </ScrollView>
  );
}

function MilestoneModal({ goal, onDismiss }: { goal: GoalView; onDismiss: () => void }) {
  const percent = Math.round(goal.pacing.progressRatio * 100);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.milestoneBackdrop}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <ZenGlass style={styles.milestoneCard}>
          <Text style={styles.milestoneTitle}>Milestone Reached!</Text>
          <View style={styles.milestoneLotus}><ZenLotusPhoto variant="milestone" width={140} /></View>
          <Text style={styles.milestoneBody}>
            You just hit {percent}% of your {goal.name} goal. Take a breath and celebrate!
          </Text>
          <PrimaryButton label="Continue the Journey" icon={ChevronRight} onPress={onDismiss} />
        </ZenGlass>
      </View>
    </Modal>
  );
}

function InsightPanel({ insight }: { insight: InsightView }) {
  const theme = useTheme();
  async function feedback(rating: 'up' | 'down') {
    await requestApi(`/api/insights/${insight.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }).catch((err) => Alert.alert('Feedback failed', err instanceof Error ? err.message : 'Unknown error'));
  }
  return (
    <ZenGlass style={styles.insightPanel}>
      <View style={styles.panelHeader}>
        <Sparkles color={theme.accent} size={20} />
        <Text style={[styles.panelKicker, { color: theme.accent }]}>{insight.kind === 'first_look' ? 'First look' : 'Weekly brief'}</Text>
      </View>
      <Text style={[styles.panelTitle, { color: theme.ink }]}>{insight.headline}</Text>
      <Text style={[styles.panelBody, { color: theme.muted }]}>{insight.body}</Text>
      <View style={[styles.actionBox, { backgroundColor: theme.accentSoft }]}>
        <Text style={[styles.actionTitle, { color: theme.ink }]}>{insight.action.description}</Text>
        <Text style={[styles.actionMeta, { color: theme.muted }]}>
          {insight.action.estimatedImpactCents ? `${usd(insight.action.estimatedImpactCents)} estimated impact · ` : ''}
          {insight.action.timeframe}
        </Text>
      </View>
      <View style={styles.inlineButtons}>
        <SecondaryButton label="Useful" onPress={() => feedback('up')} compact />
        <SecondaryButton label="Not useful" onPress={() => feedback('down')} compact />
      </View>
    </ZenGlass>
  );
}

type CoachTurn = { id: string; question: string; answer: ChatAnswerView };

function CoachScreen({ initialQuestion = '' }: { initialQuestion?: string }) {
  const theme = useTheme();
  const [question, setQuestion] = useReducerState(initialQuestion);
  const [busy, setBusy] = useReducerState(false);
  const [turns, setTurns] = useReducerState<CoachTurn[]>([]);
  const [keyboardOffset, setKeyboardOffset] = useReducerState(0);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (turns.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [turns.length]);

  // KeyboardAvoidingView's automatic self-measurement doesn't reliably pick
  // up this screen's position — it sits below a bottom tab bar inside a
  // custom rounded shell, not flush with the window edge it assumes — so the
  // composer was getting hidden entirely behind the keyboard. Track the
  // keyboard height directly instead and push the composer above it.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardOffset(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [setKeyboardOffset]);

  async function ask() {
    const trimmed = question.trim();
    if (trimmed.length < 3) return;
    setQuestion('');
    setBusy(true);
    try {
      const answer = await requestApi<ChatAnswerView>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ question: trimmed }),
      });
      setTurns((items) => [...items, { id: answer.id, question: trimmed, answer }]);
      await requestApi('/api/app-events', {
        method: 'POST',
        body: JSON.stringify({ name: 'coach:asked_question' }),
      }).catch(() => {});
    } catch (err) {
      setQuestion(trimmed);
      Alert.alert('Coach failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.flex, { paddingBottom: keyboardOffset }]}>
      <View style={styles.coachScreenHeader}>
        <Text style={styles.coachHeaderTitle}>Coach</Text>
        <Text style={styles.coachHeaderSubtitle}>MINDFUL PRESENCE</Text>
      </View>
      <FlatList
        ref={listRef}
        style={styles.flex}
        data={turns}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        ListEmptyComponent={
          <CoachPromptBoard onPress={setQuestion} />
        }
        renderItem={({ item }) => (
          <View style={styles.chatTurn}>
            <UserMessageBubble text={item.question} />
            <ChatBubble answer={item.answer} />
          </View>
        )}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.quickPromptRail, { borderColor: theme.border, backgroundColor: theme.surface }]}
        contentContainerStyle={styles.quickPromptRailContent}
      >
        <QuickPromptChip label="Can I afford this?" value="Can I afford $600 this month?" onPress={setQuestion} />
        <QuickPromptChip label="Review subscriptions" value="Which subscriptions should I cancel?" onPress={setQuestion} />
        <QuickPromptChip label="Set budget limit" value="Help me set a new budget limit." onPress={setQuestion} />
      </ScrollView>
      <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <TextInput
          style={[styles.composerInput, { color: theme.ink }]}
          placeholder="Type your financial question..."
          placeholderTextColor={theme.muted}
          value={question}
          onChangeText={setQuestion}
          returnKeyType="send"
          onSubmitEditing={ask}
        />
        <Pressable style={[styles.askZenButton, { backgroundColor: theme.accent }]} disabled={busy} onPress={ask}>
          {busy ? <ActivityIndicator color="#003737" /> : <Text style={styles.askZenArrow}>↑</Text>}
          <Text style={styles.askZenText}>Ask Zen</Text>
        </Pressable>
      </View>
    </View>
  );
}

// The small "Z" monogram avatar Stitch used for every Zen AI message, instead
// of a stand-in icon — sits at the bottom-left of the bubble, breathing on
// the same "First Breath" cadence as the lotus.
function ZenAiAvatar() {
  const { opacity, scale } = useZenBreath();
  return (
    <Animated.View style={[styles.chatBubbleIcon, { opacity, transform: [{ scale }] }]}>
      <Text style={styles.chatBubbleIconGlyph}>Z</Text>
    </Animated.View>
  );
}

function UserMessageBubble({ text }: { text: string }) {
  return (
    <View style={styles.userMessageWrap}>
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{text}</Text>
      </View>
    </View>
  );
}

function ChatBubble({ answer }: { answer: ChatAnswerView }) {
  const theme = useTheme();
  return (
    <View style={styles.aiMessageRow}>
      <ZenAiAvatar />
      <CoachCard>
        <Text style={styles.aiBubblePrefix}>ZEN COACH</Text>
        <Text style={[styles.panelBody, { color: theme.ink }]}>{answer.answer}</Text>
        <InsightLedger facts={answer.facts} />
        {answer.actions.map((action) => (
          <Text key={action} style={[styles.actionMeta, { color: theme.accent }]}>→ {action}</Text>
        ))}
      </CoachCard>
    </View>
  );
}

function CoachPromptBoard({ onPress }: { onPress: (value: string) => void }) {
  const theme = useTheme();
  const groups = [
    {
      title: 'Spending',
      icon: WalletCards,
      prompts: ['How much did I spend on coffee in the last 90 days?', 'What changed in my dining spend?'],
    },
    {
      title: 'Affordability',
      icon: CircleDollarSign,
      prompts: ['Can I afford $600 this month?', 'What would I need to cut to save $150?'],
    },
    {
      title: 'Subscriptions',
      icon: CreditCard,
      prompts: ['Which subscriptions should I cancel?', 'Did any recurring charge get more expensive?'],
    },
    {
      title: 'Goals',
      icon: Target,
      prompts: ['Am I on pace for my top goal?', 'What would move my goal up by two weeks?'],
    },
  ];

  return (
    <View style={styles.promptBoard}>
      <View style={styles.aiMessageRow}>
        <ZenAiAvatar />
        <ZenGlass style={styles.chatMessageBubble}>
          <Text style={styles.aiBubblePrefix}>ZEN COACH</Text>
          <Text style={styles.chatMessageText}>
            Good evening! Based on your spending this month, you’re on track. I found one small move that could help you reach your goal faster.
          </Text>
        </ZenGlass>
      </View>
      <View style={styles.aiMessageRow}>
        <ZenAiAvatar />
        <ZenGlass style={styles.chatMessageBubble}>
          <Text style={styles.aiBubblePrefix}>ZEN COACH</Text>
          <Text style={styles.chatMessageText}>
            Ask me about a charge, a goal, or what you can comfortably spend next.
          </Text>
        </ZenGlass>
      </View>
      <ZenGlass style={styles.coachInsightsCard}>
        <Text style={styles.coachInsightsTitle}>Your Path to Zen</Text>
        <Text style={styles.coachInsightsSubtitle}>Recent Milestones</Text>
        {[['Emergency Fund Goal Reached', 'You successfully saved $1,000', CheckCircle2], ['Mindful Spending Tip', 'Try tracking your coffee purchases', Target], ['Weekly Budget Review Completed', 'Good job staying within your limits', Sparkles]].map(([title, copy, Icon]) => {
          const InsightIcon = Icon as typeof Sparkles;
          return <View key={title as string} style={styles.coachInsightRow}><View style={styles.coachInsightIcon}><InsightIcon color="#00D2D3" size={15} /></View><View style={styles.flexShrink}><Text style={styles.coachInsightTitle}>{title as string}</Text><Text style={styles.coachInsightCopy}>{copy as string}</Text></View></View>;
        })}
      </ZenGlass>
      <Text style={styles.chatPromptLabel}>TRY ASKING</Text>
      {groups.map((group) => {
        const Icon = group.icon;
        return (
          <View key={group.title} style={[styles.promptGroup, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={styles.panelHeader}>
              <Icon color={theme.accent} size={18} />
              <Text style={[styles.actionTitle, { color: theme.ink }]}>{group.title}</Text>
            </View>
            {group.prompts.map((prompt) => (
              <Suggestion key={prompt} onPress={onPress} value={prompt} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function QuickPromptChip({ label, value, onPress }: { label: string; value: string; onPress: (value: string) => void }) {
  const theme = useTheme();
  return (
    <Pressable style={[styles.quickPromptChip, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]} onPress={() => onPress(value)}>
      <Text style={[styles.quickPromptText, { color: theme.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Suggestion({ value, onPress }: { value: string; onPress: (value: string) => void }) {
  const theme = useTheme();
  return (
    <Pressable style={[styles.suggestion, { borderColor: theme.border, backgroundColor: theme.surface }]} onPress={() => onPress(value)}>
      <Text style={[styles.suggestionText, { color: theme.ink }]}>{value}</Text>
    </Pressable>
  );
}

function PaywallScreen({
  billing,
  home,
  source,
  onChanged,
}: {
  billing: BillingStatusView;
  home?: MobileHomeSummaryView;
  source: string;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [storePackages, setStorePackages] = useReducerState<RevenueCatPackage[]>([]);
  const [selectedProductId, setSelectedProductId] = useReducerState(billing.packages[1]?.productId ?? billing.packages[0]?.productId);
  const [busy, setBusy] = useReducerState<string | null>(null);
  const [storeMessage, setStoreMessage] = useReducerState<string | null>(null);

  useEffect(() => {
    void trackBillingEvent('paywall_viewed', { source, variant: billing.pricingExperiment.variant });
    void (async () => {
      const configured = await configureRevenueCat(billing);
      if (!configured) {
        setStoreMessage('Store purchases require a RevenueCat iOS API key in the app config.');
        return;
      }
      try {
        const offerings = await Purchases.getOfferings();
        const available = offerings.current?.availablePackages ?? [];
        setStorePackages(available);
        if (available[0]) setSelectedProductId(available[0].product.identifier);
        if (available.length === 0) setStoreMessage('No RevenueCat offering is available for this app user.');
      } catch (err) {
        Sentry.captureException(err);
        setStoreMessage(err instanceof Error ? err.message : 'RevenueCat offerings could not be loaded.');
      }
    })();
  }, [billing, source]);

  const selectedStorePackage = storePackages.find((pkg) => pkg.product.identifier === selectedProductId);

  async function syncCustomerInfo(customerInfo: RevenueCatCustomerInfo): Promise<void> {
    await requestApi('/api/billing/restore', {
      method: 'POST',
      body: JSON.stringify(restorePayloadFromCustomerInfo(billing, customerInfo)),
    });
    onChanged();
  }

  async function purchase() {
    if (!selectedStorePackage) return;
    setBusy('purchase');
    try {
      await trackBillingEvent('purchase_started', { source, productId: selectedStorePackage.product.identifier });
      const result = await Purchases.purchasePackage(selectedStorePackage);
      await syncCustomerInfo(result.customerInfo);
      await trackBillingEvent('purchase_completed', { source, productId: selectedStorePackage.product.identifier });
    } catch (err) {
      await trackBillingEvent('purchase_failed', {
        source,
        productId: selectedStorePackage.product.identifier,
        message: err instanceof Error ? err.message : 'unknown',
      });
      Alert.alert('Purchase failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy('restore');
    try {
      const customerInfo = await Purchases.restorePurchases();
      await syncCustomerInfo(customerInfo);
      await trackBillingEvent('restore_completed', { source });
    } catch (err) {
      await trackBillingEvent('restore_failed', { source, message: err instanceof Error ? err.message : 'unknown' });
      Alert.alert('Restore failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  function livePrice(pkg: PaywallPackageView): string {
    const live = storePackages.find((storePkg) => storePkg.product.identifier === pkg.productId);
    return live?.product.priceString ?? pkg.priceLabel;
  }

  const totalWins = home ? home.moneyWins.verifiedTotalCents + home.moneyWins.estimatedTotalCents : 0;

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Zen-Finance Coach</Text><Text style={styles.zenPageSubtitle}>A calmer way to make your next money move</Text></View><Crown color={theme.gold} size={19} /></View>
      <ZenGlass style={styles.paywallHero}>
        <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
          <Crown color={theme.accent} size={36} />
        </View>
        <Text style={[styles.panelTitle, { color: theme.ink }]}>Keep the dollars Zen-Finance already found.</Text>
        <Text style={[styles.panelBody, { color: theme.muted }]}>{billing.pricingExperiment.paywallBody}</Text>
        <StatusRail>
          <MoneyMetric label="Found" value={home ? usd(totalWins, true) : 'Coach'} icon={CircleDollarSign} />
          <MoneyMetric label="Audit" value={home ? String(home.subscriptionAudit.cancelCandidateCount) : 'Subs'} icon={CreditCard} />
          <MoneyMetric label="Forecast" value="What-if" icon={SlidersHorizontal} />
          <MoneyMetric label="Chat" value="24/7" icon={MessageCircle} />
        </StatusRail>
        <View style={styles.featureList}>
          <FeatureLine text="Ask the coach scoped questions from your own transactions" />
          <FeatureLine text="Run what-if forecasts before a goal slips off pace" />
          <FeatureLine text="Audit subscriptions and track every verified Money Win" />
        </View>
      </ZenGlass>

      {billing.packages.map((pkg) => {
        const selected = selectedProductId === pkg.productId;
        const featured = pkg.identifier === 'annual' && Boolean(pkg.savingsLabel);
        return (
          <PlanOption
            key={pkg.productId}
            selected={selected}
            featured={featured}
            title={pkg.identifier === 'annual' ? 'Annual' : 'Monthly'}
            detail={`${pkg.introTrialDays}-day trial · ${pkg.savingsLabel ?? 'Cancel anytime'}`}
            price={livePrice(pkg)}
            onPress={() => setSelectedProductId(pkg.productId)}
          />
        );
      })}

      {storeMessage ? <Text style={[styles.actionMeta, { color: theme.gold }]}>{storeMessage}</Text> : null}
      <PrimaryButton
        label={busy === 'purchase' ? 'Purchasing...' : 'Start free trial'}
        icon={LockKeyhole}
        disabled={busy !== null || !selectedStorePackage}
        onPress={purchase}
      />
      <Text style={[styles.disclosure, { color: theme.muted }]}>
        Trial and renewal are managed by the App Store. Cancel anytime before renewal.
      </Text>
      <SecondaryButton
        label={busy === 'restore' ? 'Restoring...' : 'Restore purchases'}
        icon={RefreshCcw}
        disabled={busy !== null}
        onPress={restore}
      />
    </ScrollView>
  );
}

function FeatureLine({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.featureLine}>
      <CheckCircle2 color={theme.success} size={17} />
      <Text style={[styles.featureText, { color: theme.ink }]}>{text}</Text>
    </View>
  );
}

function goalIcon(name: string): MaterialSymbolName {
  const key = name.toLowerCase();
  if (key.includes('emergency')) return 'shield';
  if (key.includes('car') || key.includes('vehicle') || key.includes('auto')) return 'directions_car';
  if (key.includes('trip') || key.includes('travel') || key.includes('vacation') || key.includes('japan') || key.includes('flight')) return 'flight';
  if (key.includes('home') || key.includes('house')) return 'home';
  if (key.includes('school') || key.includes('education') || key.includes('tuition')) return 'school';
  if (key.includes('health') || key.includes('medical')) return 'medical_services';
  if (key.includes('wedding')) return 'favorite';
  return 'savings';
}

function GoalsScreen({ goals, billing, onChanged }: { goals: GoalView[]; billing: BillingStatusView; onChanged: () => void }) {
  const theme = useTheme();
  const [name, setName] = useReducerState('');
  const [target, setTarget] = useReducerState('');
  const [saving, setSaving] = useReducerState(false);
  const [scenario, setScenario] = useReducerState<WhatIfResultView | null>(null);
  const [scenarioGoalId, setScenarioGoalId] = useReducerState<number | null>(null);
  const [scenarioDraft, setScenarioDraft] = useReducerState<WhatIfDraft>({
    monthlySavings: '',
    oneTimeSavings: '',
    monthlySpendReduction: '',
    monthlyIncomeChange: '',
  });
  const [scenarioError, setScenarioError] = useReducerState<string | null>(null);
  const [runningScenario, setRunningScenario] = useReducerState(false);
  const [showAdvancedScenario, setShowAdvancedScenario] = useReducerState(false);
  const [showPaywall, setShowPaywall] = useReducerState(false);
  const [dismissedMilestoneIds, setDismissedMilestoneIds] = useReducerState<Set<number>>(new Set());
  const atFreeGoalLimit = !billing.isPremium && goals.filter((goal) => goal.status === 'active').length >= (billing.limits.maxActiveGoals ?? Number.POSITIVE_INFINITY);
  const milestoneGoal = goals.find((goal) => goal.pacing.progressRatio >= 0.5 && !dismissedMilestoneIds.has(goal.id));

  async function addGoal() {
    const dollars = Number(target);
    if (!name.trim() || !Number.isFinite(dollars) || dollars <= 0) return;
    setSaving(true);
    try {
      await requestApi('/api/goals', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), targetAmountCents: Math.round(dollars * 100) }),
      });
      setName('');
      setTarget('');
      onChanged();
    } catch (err) {
      Alert.alert('Goal failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  function openScenario(goalId: number) {
    setScenarioGoalId(goalId);
    setScenario(null);
    setScenarioError(null);
    setShowAdvancedScenario(hasAdvancedWhatIfAdjustments(scenarioDraft));
  }

  function closeScenario() {
    setScenarioGoalId(null);
    setScenario(null);
    setScenarioError(null);
  }

  function updateScenarioDraft(field: keyof WhatIfDraft, value: string) {
    setScenarioDraft((current) => ({ ...current, [field]: value }));
    setScenario(null);
    setScenarioError(null);
  }

  async function runScenario(goalId: number) {
    if (!billing.isPremium) return;
    const request = buildWhatIfRequest(goalId, scenarioDraft);
    if (!request.ok) {
      setScenarioError(request.error);
      return;
    }
    setRunningScenario(true);
    setScenario(null);
    setScenarioError(null);
    try {
      setScenario(
        await requestApi<WhatIfResultView>('/api/what-if', {
          method: 'POST',
          body: JSON.stringify(request.value),
        }),
      );
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : 'The forecast could not be completed.');
    } finally {
      setRunningScenario(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Zen Savings Goals</Text><Text style={styles.zenPageSubtitle}>Small steps, meaningful progress</Text></View><Target color={theme.accent} size={19} /></View>
      <ZenGlass style={styles.mindfulSavingsHero}>
        <MaterialSymbol name="savings" size={54} color="#FFFFFF1F" style={styles.mindfulSavingsWatermark} />
        <Text style={styles.mindfulSavingsLabel}>Total Savings</Text>
        <Text style={styles.mindfulSavingsAmount}>{usd(goals.reduce((sum, goal) => sum + goal.currentAmountCents, 0))}</Text>
        <Text style={styles.mindfulSavingsCaption}>Across {goals.length} active {goals.length === 1 ? 'goal' : 'goals'}</Text>
      </ZenGlass>
      <View style={styles.goalsSectionRow}>
        <Text style={styles.zenSectionLabel}>YOUR INTENTIONS</Text>
        <Text style={styles.goalsSectionCount}>{goals.length} Active {goals.length === 1 ? 'Goal' : 'Goals'}</Text>
      </View>
      {milestoneGoal ? (
        <MilestoneModal
          goal={milestoneGoal}
          onDismiss={() => setDismissedMilestoneIds((prev) => new Set(prev).add(milestoneGoal.id))}
        />
      ) : null}
      {goals.map((goal) => (
        <ZenGlass key={goal.id} style={styles.goalCardGlass}>
          <View style={styles.goalCardHeaderRow}>
            <View style={styles.goalCardIcon}>
              <MaterialSymbol name={goalIcon(goal.name)} size={20} color={theme.accent} />
            </View>
            <Text style={styles.goalCardName}>{goal.name}</Text>
          </View>
          <View style={styles.goalProgressTrack}>
            <View style={[styles.goalProgressFill, { width: `${Math.min(100, Math.max(0, goal.pacing.progressRatio * 100))}%` }]} />
          </View>
          <View style={styles.goalCardMetaRow}>
            <Text style={styles.goalCardAmount}>{usd(goal.currentAmountCents, true)} / {usd(goal.targetAmountCents, true)}</Text>
            <Text style={styles.goalCardPercent}>{Math.round(goal.pacing.progressRatio * 100)}% complete</Text>
          </View>
          <Text style={[styles.panelBody, { color: theme.muted }]}>{goalCoachSentence(goal)}</Text>
          <StatusRail>
            <MoneyMetric label="Current" value={usd(goal.currentAmountCents, true)} icon={PiggyBank} />
            <MoneyMetric label="Target" value={usd(goal.targetAmountCents, true)} icon={Target} />
            <MoneyMetric label="Pace" value={pacingLabel(goal.pacing.pacingStatus)} icon={SlidersHorizontal} />
          </StatusRail>
          <Text style={[styles.factLine, { color: theme.muted }]}>
            Projected completion: {dateLabel(goal.pacing.projectedCompletionDate)}
          </Text>
          {scenarioGoalId !== goal.id ? (
            <SecondaryButton
              label={billing.isPremium ? 'Forecast this goal' : 'Unlock goal forecasts'}
              icon={SlidersHorizontal}
              disabled={runningScenario}
              onPress={() => (billing.isPremium ? openScenario(goal.id) : setShowPaywall(true))}
            />
          ) : null}
          {scenarioGoalId === goal.id ? (
            <View style={[styles.whatIfPlanner, { borderColor: theme.border }]}>
              <View style={styles.panelHeader}>
                <SlidersHorizontal color={theme.accent} size={19} />
                <View style={styles.flexShrink}>
                  <Text style={[styles.panelKicker, { color: theme.accent }]}>Savings forecast</Text>
                  <Text style={[styles.whatIfPlannerTitle, { color: theme.ink }]}>When will I reach {goal.name}?</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close savings forecast"
                  accessibilityRole="button"
                  disabled={runningScenario}
                  onPress={closeScenario}
                  style={[styles.whatIfCloseButton, { borderColor: theme.border, backgroundColor: theme.surface, opacity: runningScenario ? 0.5 : 1 }]}
                >
                  <X color={theme.muted} size={17} />
                </Pressable>
              </View>
              <Text style={[styles.rowDetail, { color: theme.muted }]}>Start with what you plan to save each month. The forecast begins this month and will not move money.</Text>
              <View style={styles.whatIfField}>
                <Text style={[styles.whatIfFieldLabel, { color: theme.ink }]}>Planned monthly savings</Text>
                <Text style={[styles.whatIfFieldHint, { color: theme.muted }]}>What you will deposit into this goal each month</Text>
                <View style={[styles.whatIfMoneyInput, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  <Text style={[styles.whatIfCurrency, { color: theme.muted }]}>$</Text>
                  <TextInput
                    accessibilityLabel="Planned monthly savings amount"
                    editable={!runningScenario}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    value={scenarioDraft.monthlySavings}
                    onChangeText={(value) => updateScenarioDraft('monthlySavings', value)}
                    style={[styles.whatIfTextInput, { color: theme.ink }]}
                  />
                  <Text style={[styles.whatIfInputSuffix, { color: theme.muted }]}>/mo</Text>
                </View>
              </View>
              <View style={styles.whatIfPresetRow}>
                <ScenarioPreset label="$50/mo" disabled={runningScenario} onPress={() => updateScenarioDraft('monthlySavings', '50')} />
                <ScenarioPreset label="$150/mo" disabled={runningScenario} onPress={() => updateScenarioDraft('monthlySavings', '150')} />
                <ScenarioPreset label="$300/mo" disabled={runningScenario} onPress={() => updateScenarioDraft('monthlySavings', '300')} />
                <ScenarioPreset label="$500/mo" disabled={runningScenario} onPress={() => updateScenarioDraft('monthlySavings', '500')} />
              </View>
              <View style={styles.whatIfField}>
                <Text style={[styles.whatIfFieldLabel, { color: theme.ink }]}>One-time savings <Text style={{ color: theme.muted }}>(optional)</Text></Text>
                <Text style={[styles.whatIfFieldHint, { color: theme.muted }]}>Money you plan to add this month before recurring deposits</Text>
                <View style={[styles.whatIfMoneyInput, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  <Text style={[styles.whatIfCurrency, { color: theme.muted }]}>$</Text>
                  <TextInput
                    accessibilityLabel="One-time savings amount"
                    editable={!runningScenario}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    value={scenarioDraft.oneTimeSavings}
                    onChangeText={(value) => updateScenarioDraft('oneTimeSavings', value)}
                    style={[styles.whatIfTextInput, { color: theme.ink }]}
                  />
                </View>
              </View>
              <View style={styles.whatIfPresetRow}>
                <ScenarioPreset label="$250 once" disabled={runningScenario} onPress={() => updateScenarioDraft('oneTimeSavings', '250')} />
                <ScenarioPreset label="$500 once" disabled={runningScenario} onPress={() => updateScenarioDraft('oneTimeSavings', '500')} />
                <ScenarioPreset label="$1,000 once" disabled={runningScenario} onPress={() => updateScenarioDraft('oneTimeSavings', '1000')} />
              </View>
              <Pressable
                accessibilityLabel="Toggle optional cash-flow adjustments"
                accessibilityRole="button"
                accessibilityState={{ expanded: showAdvancedScenario, disabled: runningScenario }}
                disabled={runningScenario}
                onPress={() => setShowAdvancedScenario((current) => !current)}
                style={[styles.whatIfAdvancedToggle, { borderColor: theme.border, backgroundColor: theme.surface }]}
              >
                <View style={styles.flexShrink}>
                  <Text style={[styles.whatIfFieldLabel, { color: theme.ink }]}>Cash-flow adjustments</Text>
                  <Text style={[styles.whatIfFieldHint, { color: theme.muted }]}>Optional spending or income changes</Text>
                </View>
                <ChevronRight color={theme.accent} size={17} style={{ transform: [{ rotate: showAdvancedScenario ? '90deg' : '0deg' }] }} />
              </Pressable>
              {showAdvancedScenario ? (
                <View style={styles.whatIfAdvancedFields}>
                  <View style={styles.whatIfField}>
                    <Text style={[styles.whatIfFieldLabel, { color: theme.ink }]}>Monthly spending reduction</Text>
                    <Text style={[styles.whatIfFieldHint, { color: theme.muted }]}>What you could redirect each month</Text>
                    <View style={[styles.whatIfMoneyInput, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                      <Text style={[styles.whatIfCurrency, { color: theme.muted }]}>$</Text>
                      <TextInput
                        accessibilityLabel="Monthly spending reduction amount"
                        editable={!runningScenario}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.muted}
                        value={scenarioDraft.monthlySpendReduction}
                        onChangeText={(value) => updateScenarioDraft('monthlySpendReduction', value)}
                        style={[styles.whatIfTextInput, { color: theme.ink }]}
                      />
                      <Text style={[styles.whatIfInputSuffix, { color: theme.muted }]}>/mo</Text>
                    </View>
                  </View>
                  <View style={styles.whatIfField}>
                    <Text style={[styles.whatIfFieldLabel, { color: theme.ink }]}>Monthly income change</Text>
                    <Text style={[styles.whatIfFieldHint, { color: theme.muted }]}>Use a minus sign if income may decrease</Text>
                    <View style={[styles.whatIfMoneyInput, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                      <Text style={[styles.whatIfCurrency, { color: theme.muted }]}>$</Text>
                      <TextInput
                        accessibilityLabel="Monthly income change amount"
                        editable={!runningScenario}
                        keyboardType="numbers-and-punctuation"
                        placeholder="+500 or -200"
                        placeholderTextColor={theme.muted}
                        value={scenarioDraft.monthlyIncomeChange}
                        onChangeText={(value) => updateScenarioDraft('monthlyIncomeChange', value)}
                        style={[styles.whatIfTextInput, { color: theme.ink }]}
                      />
                      <Text style={[styles.whatIfInputSuffix, { color: theme.muted }]}>/mo</Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {scenarioError ? <Text style={styles.whatIfError}>{scenarioError}</Text> : null}
              <PrimaryButton
                label={runningScenario ? 'Forecasting...' : 'Forecast my goal'}
                icon={Sparkles}
                disabled={runningScenario}
                onPress={() => runScenario(goal.id)}
              />
              {scenario ? (
                <View style={[styles.whatIfResult, { borderColor: theme.accent }]}>
                  <View style={styles.panelHeader}>
                    <CheckCircle2 color={theme.success} size={19} />
                    <Text style={[styles.panelKicker, { color: theme.success }]}>Forecast result</Text>
                  </View>
                  <Text style={[styles.panelBody, { color: theme.muted }]}>{scenario.narration}</Text>
                  {(scenario.monthlySavingsCents ?? 0) > 0 ? (
                    <>
                      {scenario.projections.map((projection) => (
                        <MonthlySavingsForecast
                          key={projection.goalId}
                          forecastStartMonth={scenario.forecastStartMonth}
                          projection={projection}
                        />
                      ))}
                      <StatusRail>
                        <MoneyMetric label="Monthly" value={`${usd(scenario.monthlySavingsCents, true)}/mo`} icon={PiggyBank} />
                        <MoneyMetric label="One-time" value={usd(scenario.oneTimeSavingsCents, true)} icon={Plus} />
                        <MoneyMetric label="To fund" value={usd(scenario.projections[0]?.remainingAmountCents, true)} icon={Target} />
                      </StatusRail>
                    </>
                  ) : (
                    <>
                      <StatusRail>
                        <MoneyMetric label="One-time" value={usd(scenario.oneTimeSavingsCents, true)} icon={PiggyBank} />
                        <MoneyMetric label="Monthly cut" value={usd(scenario.monthlySpendReductionCents, true)} icon={CreditCard} />
                        <MoneyMetric label="Income" value={usd(scenario.monthlyIncomeChangeCents, true)} icon={CircleDollarSign} />
                      </StatusRail>
                      {scenario.projections.map((projection) => (
                        <View key={projection.goalId} style={[styles.scenarioRow, { borderColor: theme.border }]}>
                          <View style={styles.flexShrink}>
                            <Text style={[styles.rowTitle, { color: theme.ink }]}>{projection.name}</Text>
                            <Text style={[styles.rowDetail, { color: theme.muted }]}>
                              {dateLabel(projection.currentProjectedCompletionDate)} → {dateLabel(projection.simulatedProjectedCompletionDate)}
                            </Text>
                          </View>
                          <Text style={[
                            styles.amount,
                            {
                              color: scenarioTimelineTone(projection) === 'danger'
                                ? theme.danger
                                : scenarioTimelineTone(projection) === 'muted'
                                  ? theme.muted
                                  : theme.success,
                            },
                          ]}>
                            {scenarioTimelineLabel(projection)}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                  {scenario.monthlySpendReductionCents > 0 || scenario.monthlyIncomeChangeCents !== 0 ? (
                    <View style={[styles.whatIfWeeklyImpact, { backgroundColor: theme.accentSoft }]}>
                      <Text style={[styles.whatIfWeeklyLabel, { color: theme.muted }]}>Weekly cash-flow change</Text>
                      <Text style={[styles.whatIfWeeklyValue, { color: scenario.weeklyNetChangeCents >= 0 ? theme.success : theme.danger }]}>
                        {scenario.weeklyNetChangeCents > 0 ? '+' : ''}{usd(scenario.weeklyNetChangeCents, true)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </ZenGlass>
      ))}
      <SectionHeader title="New Goal" />
      {atFreeGoalLimit || showPaywall ? (
        <PaywallScreen billing={billing} source="goals_limit" onChanged={onChanged} />
      ) : (
        <SectionBand>
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            placeholder="Goal name"
            placeholderTextColor={theme.muted}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            placeholder="Target amount"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            value={target}
            onChangeText={setTarget}
          />
          <PrimaryButton label={saving ? 'Saving...' : 'Add goal'} icon={Plus} disabled={saving} onPress={addGoal} />
        </SectionBand>
      )}
    </ScrollView>
  );
}

function pacingLabel(value: GoalView['pacing']['pacingStatus']): string {
  return titleCaseFromCode(value);
}

function scenarioTimelineLabel(projection: WhatIfResultView['projections'][number]): string {
  if (projection.currentProjectedCompletionDate && !projection.simulatedProjectedCompletionDate) return 'Completion at risk';
  if (!projection.currentProjectedCompletionDate && projection.simulatedProjectedCompletionDate) return 'Date now available';
  if (projection.timelineChangeWeeks === undefined) {
    return projection.weeksFaster !== null && projection.weeksFaster > 0 ? `${projection.weeksFaster}w sooner` : 'Updated forecast';
  }
  if (projection.timelineChangeWeeks === null) return 'Not enough data';
  if (projection.timelineChangeWeeks > 0) return `${projection.timelineChangeWeeks}w sooner`;
  if (projection.timelineChangeWeeks < 0) return `${Math.abs(projection.timelineChangeWeeks)}w later`;
  return 'Same timeline';
}

function scenarioTimelineTone(projection: WhatIfResultView['projections'][number]): 'danger' | 'success' | 'muted' {
  if (projection.currentProjectedCompletionDate && !projection.simulatedProjectedCompletionDate) return 'danger';
  if (!projection.currentProjectedCompletionDate && projection.simulatedProjectedCompletionDate) return 'success';
  if (projection.timelineChangeWeeks === undefined) return projection.weeksFaster !== null && projection.weeksFaster > 0 ? 'success' : 'muted';
  if (projection.timelineChangeWeeks === null) return 'muted';
  return projection.timelineChangeWeeks < 0 ? 'danger' : 'success';
}

function forecastMonthLabel(value: string | null | undefined): string {
  if (!value) return 'this month';
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function forecastDurationLabel(months: number | null | undefined): string {
  if (months === null || months === undefined) return 'Not available';
  if (months === 0) return 'This month';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return `${years} yr${years === 1 ? '' : 's'}${remainder ? ` ${remainder} mo` : ''}`;
}

function MonthlySavingsForecast({
  forecastStartMonth,
  projection,
}: {
  forecastStartMonth?: string;
  projection: WhatIfResultView['projections'][number];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.monthlyForecastCard, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]}>
      <View style={styles.monthlyForecastTopRow}>
        <View style={styles.flexShrink}>
          <Text style={[styles.monthlyForecastKicker, { color: theme.accent }]}>Starting {forecastMonthLabel(forecastStartMonth)}</Text>
          <Text style={[styles.monthlyForecastGoal, { color: theme.ink }]}>{projection.name}</Text>
        </View>
        <CalendarDays size={22} color={theme.accent} />
      </View>
      <Text style={[styles.monthlyForecastDuration, { color: theme.ink }]}>{forecastDurationLabel(projection.plannedMonthsToGoal)}</Text>
      {projection.plannedCompletionMonth ? (
        <Text style={[styles.monthlyForecastCompletion, { color: theme.muted }]}>
          Estimated completion: {forecastMonthLabel(projection.plannedCompletionMonth)}
        </Text>
      ) : null}
    </View>
  );
}

function ScenarioPreset({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use ${label} scenario`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.whatIfPreset, { borderColor: theme.border, backgroundColor: theme.surface, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.whatIfPresetText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

function goalCoachSentence(goal: GoalView): string {
  const remaining = usd(goal.pacing.remainingAmountCents, true);
  const projected = dateLabel(goal.pacing.projectedCompletionDate);
  if (goal.pacing.pacingStatus === 'on_track') return `${remaining} left, projected for ${projected}. Keep the current pace.`;
  if (goal.pacing.pacingStatus === 'ahead') return `${remaining} left, projected for ${projected}. You have room to protect this win.`;
  if (goal.pacing.pacingStatus === 'behind') return `${remaining} left, projected for ${projected}. A small weekly adjustment can pull this back on track.`;
  return `${remaining} left. Add more activity and the coach will calculate a clearer pace.`;
}

function ProgressBar({ value }: { value: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.progressTrack, { backgroundColor: theme.surfaceAlt }]}>
      <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, value * 100))}%`, backgroundColor: theme.accent }]} />
    </View>
  );
}

function SubscriptionsScreen({ audit, onChanged }: { audit: SubscriptionAuditView; onChanged: () => void }) {
  const theme = useTheme();
  async function cancel(recurringStreamId: number) {
    try {
      await requestApi('/api/subscriptions/cancel', {
        method: 'POST',
        body: JSON.stringify({ recurringStreamId }),
      });
      onChanged();
    } catch (err) {
      Alert.alert('Could not record cancellation', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Subscription Audit</Text><Text style={styles.zenPageSubtitle}>Quietly review what repeats</Text></View><CreditCard color={theme.accent} size={19} /></View>
      <SubscriptionMetricStrip audit={audit} />
      {audit.items.map((item) => (
        <ZenGlass key={item.recurringStreamId} style={styles.auditCard}>
          <View style={styles.panelHeader}>
            <CreditCard color={item.isCancelCandidate ? theme.gold : theme.accent} size={20} />
            <Text style={[styles.panelKicker, { color: item.isCancelCandidate ? theme.gold : theme.accent }]}>
              {item.cadence}
            </Text>
          </View>
          <Text style={[styles.panelTitle, { color: theme.ink }]}>{item.merchantClean}</Text>
          <Text style={[styles.rowDetail, { color: theme.muted }]}>
            {usd(item.monthlyEquivalentCents)}/mo normalized · last charged {dateLabel(item.lastSeenDate)}
          </Text>
          {item.priceCreep ? <Text style={[styles.actionMeta, { color: theme.gold }]}>Price creep: {usd(item.priceCreepCents)}</Text> : null}
          {item.isCancelCandidate ? <SecondaryButton label="I canceled this" icon={CheckCircle2} onPress={() => cancel(item.recurringStreamId)} /> : null}
        </ZenGlass>
      ))}
    </ScrollView>
  );
}

function WinsScreen({
  wins,
  moneyPhysical,
  billing,
  anomalies,
  onChanged,
}: {
  wins: MoneyWinsSummaryView;
  moneyPhysical: MoneyPhysicalStatusView;
  billing: BillingStatusView;
  anomalies: AnomalyView[];
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [physicalBusy, setPhysicalBusy] = useReducerState<string | null>(null);
  const [physicalProduct, setPhysicalProduct] = useReducerState<RevenueCatStoreProduct | null>(null);
  const [physicalMessage, setPhysicalMessage] = useReducerState<string | null>(null);

  useEffect(() => {
    if (moneyPhysical.purchased) return;
    void (async () => {
      const configured = await configureRevenueCat(billing);
      if (!configured) {
        setPhysicalMessage('Store purchases require a RevenueCat iOS API key in the app config.');
        return;
      }
      try {
        const products = await Purchases.getProducts([MONEY_PHYSICAL_PRODUCT_ID], Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
        setPhysicalProduct(products[0] ?? null);
        if (!products[0]) setPhysicalMessage('Money Physical is not available from the store yet.');
      } catch (err) {
        Sentry.captureException(err);
        setPhysicalMessage(err instanceof Error ? err.message : 'Money Physical could not be loaded.');
      }
    })();
  }, [billing, moneyPhysical.purchased]);

  async function syncMoneyPhysical(customerInfo: RevenueCatCustomerInfo) {
    const payload = moneyPhysicalPayloadFromCustomerInfo(billing, customerInfo);
    if (!payload) throw new Error('Money Physical purchase was not found on this RevenueCat customer.');
    await requestApi('/api/money-physical/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    onChanged();
  }

  async function purchaseMoneyPhysical() {
    if (!physicalProduct) return;
    setPhysicalBusy('purchase');
    try {
      await trackBillingEvent('money_physical_purchase_started', { productId: MONEY_PHYSICAL_PRODUCT_ID });
      const result = await Purchases.purchaseStoreProduct(physicalProduct);
      await syncMoneyPhysical(result.customerInfo);
      await trackBillingEvent('money_physical_purchase_completed', { productId: MONEY_PHYSICAL_PRODUCT_ID });
    } catch (err) {
      await trackBillingEvent('money_physical_purchase_failed', {
        productId: MONEY_PHYSICAL_PRODUCT_ID,
        message: err instanceof Error ? err.message : 'unknown',
      });
      Alert.alert('Money Physical', err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setPhysicalBusy(null);
    }
  }

  async function restoreMoneyPhysical() {
    setPhysicalBusy('restore');
    try {
      const configured = await configureRevenueCat(billing);
      if (!configured) {
        Alert.alert('RevenueCat not configured', 'Add the iOS RevenueCat public API key in app.json to restore store purchases.');
        return;
      }
      const customerInfo = await Purchases.restorePurchases();
      await syncMoneyPhysical(customerInfo);
      await trackBillingEvent('money_physical_restore_completed', { productId: MONEY_PHYSICAL_PRODUCT_ID });
    } catch (err) {
      await trackBillingEvent('money_physical_restore_failed', {
        productId: MONEY_PHYSICAL_PRODUCT_ID,
        message: err instanceof Error ? err.message : 'unknown',
      });
      Alert.alert('Money Physical', err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setPhysicalBusy(null);
    }
  }

  async function confirm(id: number) {
    await requestApi(`/api/money-wins/${id}/confirm`, { method: 'POST' });
    onChanged();
  }
  async function recover(id: number) {
    await requestApi(`/api/anomalies/${id}/recover`, { method: 'POST' });
    onChanged();
  }
  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Money Wins</Text><Text style={styles.zenPageSubtitle}>Celebrate the money you kept</Text></View><PiggyBank color={theme.accent} size={19} /></View>
      <ZenGlass style={styles.moneyPhysicalHero}>
        <View style={styles.panelHeader}>
          <ShieldCheck color={theme.accent} size={20} />
          <Text style={[styles.panelKicker, { color: theme.accent }]}>Money Physical</Text>
        </View>
        {moneyPhysical.latestReport ? (
          <>
            <Text style={[styles.bigNumber, { color: theme.ink }]}>{moneyPhysical.latestReport.score}/100</Text>
            <Text style={[styles.panelTitle, { color: theme.ink }]}>{moneyPhysical.latestReport.headline}</Text>
            <Text style={[styles.panelBody, { color: theme.muted }]}>{moneyPhysical.latestReport.summary}</Text>
            <StatusRail>
              <MoneyMetric label="90-day net" value={usd(moneyPhysical.latestReport.sections.cashFlow.netCashFlowCents, true)} icon={WalletCards} />
              <MoneyMetric label="Recurring" value={usd(moneyPhysical.latestReport.sections.recurring.totalMonthlyCents, true)} icon={CreditCard} />
            </StatusRail>
            {moneyPhysical.latestReport.actions.map((action) => (
              <View key={action.title} style={[styles.actionBox, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.actionTitle, { color: theme.ink }]}>{action.title}</Text>
                <Text style={[styles.actionMeta, { color: theme.muted }]}>{action.detail}</Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={[styles.panelTitle, { color: theme.ink }]}>90-day money checkup</Text>
            <Text style={[styles.panelBody, { color: theme.muted }]}>
              A one-time report that scores cash flow, spending concentration, goal pacing, recurring charges, and Money Wins.
            </Text>
            {physicalMessage ? <Text style={[styles.actionMeta, { color: theme.gold }]}>{physicalMessage}</Text> : null}
            <PrimaryButton
              label={physicalBusy === 'purchase' ? 'Purchasing...' : `Buy ${physicalProduct?.priceString ?? moneyPhysical.priceLabel}`}
              icon={ShieldCheck}
              disabled={physicalBusy !== null || !physicalProduct}
              onPress={purchaseMoneyPhysical}
            />
            <SecondaryButton
              label={physicalBusy === 'restore' ? 'Restoring...' : 'Restore Money Physical'}
              icon={RefreshCcw}
              disabled={physicalBusy !== null}
              onPress={restoreMoneyPhysical}
            />
          </>
        )}
      </ZenGlass>
      <ZenGlass style={styles.moneyWinsHero}>
        <Text style={[styles.panelKicker, { color: theme.accent }]}>Money Wins</Text>
        <Text style={[styles.bigNumber, { color: theme.ink }]}>{usd(wins.verifiedTotalCents + wins.estimatedTotalCents, true)}</Text>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>
          {usd(wins.verifiedTotalCents, true)} verified · {usd(wins.estimatedTotalCents, true)} estimated
        </Text>
      </ZenGlass>
      {wins.wins.map((win) => (
        <ZenGlass key={win.id} style={styles.glassRow}>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{win.description}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{titleCaseFromCode(win.status)} · {dateLabel(win.createdAt)}</Text>
          </View>
          <View style={styles.rightStack}>
            <Text style={[styles.amount, { color: win.status === 'verified' ? theme.success : theme.gold }]}>{usd(win.amountCents, true)}</Text>
            {win.status === 'estimated' ? <Pressable onPress={() => confirm(win.id)}><Text style={[styles.linkText, { color: theme.accent }]}>confirm</Text></Pressable> : null}
          </View>
        </ZenGlass>
      ))}
      <SectionHeader title="Charge Alerts" />
      {anomalies.map((item) => (
        <ZenGlass key={item.id} style={styles.glassRow}>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{item.title}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{item.detail}</Text>
          </View>
          <Pressable onPress={() => recover(item.id)}>
            <Text style={[styles.linkText, { color: theme.accent }]}>recovered</Text>
          </Pressable>
        </ZenGlass>
      ))}
    </ScrollView>
  );
}

function SettingsScreen({
  accountProfile,
  section,
  items,
  billing,
  onBack,
  onChanged,
  onNavigate,
}: {
  accountProfile: AccountProfileView | null;
  section: SettingsSection;
  items: LinkedItem[];
  billing: BillingStatusView;
  onBack: () => void;
  onChanged: () => void;
  onNavigate: (tab: TabKey) => void;
}) {
  const theme = useTheme();
  const prefs = useAppStore((s) => s.notificationPrefs);
  const setPrefs = useAppStore((s) => s.setNotificationPrefs);
  const setTokens = useAppStore((s) => s.setTokens);
  const {
    billingBusy, setBillingBusy, referral, setReferral, redeemCode, setRedeemCode,
    referralBusy, setReferralBusy, freelancer, setFreelancer, freelancerBusy, setFreelancerBusy,
    targetIncome, setTargetIncome, taxSetAside, setTaxSetAside, runwayTarget, setRunwayTarget,
    household, setHousehold, householdBusy, setHouseholdBusy, householdInviteEmail, setHouseholdInviteEmail,
    householdInviteCode, setHouseholdInviteCode, sharedGoalName, setSharedGoalName,
    sharedGoalTarget, setSharedGoalTarget, householdContribution, setHouseholdContribution,
    updateBusy, setUpdateBusy,
  } = useSettingsScreenState();

  const updateMeta = [
    `Build marker: ${OTA_DIAGNOSTIC_LABEL}`,
    `Channel: ${Updates.channel ?? 'embedded'}`,
    `Runtime: ${Updates.runtimeVersion ?? 'unknown'}`,
    `Update ID: ${Updates.updateId ?? 'embedded'}`,
  ].join('\n');

  useEffect(() => {
    if (section !== 'referral') return;
    requestApi<ReferralStatusView>('/api/referrals/me')
      .then(setReferral)
      .catch(() => setReferral(null));
  }, [section]);

  const loadFreelancer = useCallback(async () => {
    if (!billing.isPremium) {
      setFreelancer(null);
      return;
    }
    try {
      const summary = await requestApi<FreelancerSummaryView>('/api/freelancer/summary');
      setFreelancer(summary);
      setTargetIncome(centsToDollarInput(summary.profile.targetMonthlyIncomeCents));
      setTaxSetAside(String(Math.round(summary.profile.taxSetAsideBps / 100)));
      setRunwayTarget(String(summary.profile.runwayTargetMonths));
    } catch {
      setFreelancer(null);
    }
  }, [billing.isPremium]);

  useEffect(() => {
    if (section === 'freelancer') void loadFreelancer();
  }, [loadFreelancer, section]);

  const loadHousehold = useCallback(async () => {
    try {
      setHousehold(await requestApi<HouseholdStatusView>('/api/household'));
    } catch {
      setHousehold(null);
    }
  }, []);

  useEffect(() => {
    if (section === 'household') void loadHousehold();
  }, [loadHousehold, section]);

  async function registerPush() {
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Notifications are off', 'Enable notifications in iOS Settings if you want financial alerts.');
        return;
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      const next = await requestApi<NotificationPreferencesView>('/api/push-tokens', {
        method: 'POST',
        body: JSON.stringify({ token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
      });
      await SecureStore.setItemAsync('expoPushToken', token.data, DEVICE_BOUND_STORE_OPTIONS);
      setPrefs(next);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert('Notifications unavailable', err instanceof Error ? err.message : 'Unable to enable notifications.');
    }
  }

  async function updatePrefs(next: NotificationPreferencesView) {
    try {
      const saved = await requestApi<NotificationPreferencesView>('/api/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          weeklyBrief: next.weeklyBrief,
          anomalies: next.anomalies,
          goalPacing: next.goalPacing,
          marketing: next.marketing,
        }),
      });
      setPrefs(saved);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert('Preference not saved', err instanceof Error ? err.message : 'Unable to update notifications.');
    }
  }

  async function checkForUpdate() {
    if (!Updates.isEnabled) {
      Alert.alert('Updates unavailable', 'This build was not configured for OTA updates.');
      return;
    }
    setUpdateBusy(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('No update found', `You are on the latest update for ${Updates.channel ?? 'this channel'}.`);
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'Zen-Finance will restart now to apply the latest bundle.', [
        { text: 'Restart', onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (err) {
      Alert.alert('Update check failed', err instanceof Error ? err.message : 'Unable to check for updates.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function disconnect(itemId: number) {
    const item = items.find((candidate) => candidate.id === itemId);
    Alert.alert(
      'Disconnect bank?',
      `This removes ${item?.institutionName ?? 'this bank'} and its imported transaction history from Zen-Finance.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void requestApi(`/api/items/${itemId}`, { method: 'DELETE' })
            .then(onChanged)
            .catch((err) => Alert.alert('Disconnect failed', err instanceof Error ? err.message : 'Unable to disconnect bank.')),
        },
      ],
    );
  }

  async function restorePurchases() {
    setBillingBusy(true);
    try {
      const configured = await configureRevenueCat(billing);
      if (!configured) {
        Alert.alert('RevenueCat not configured', 'Add the iOS RevenueCat public API key in app.json to restore store purchases.');
        return;
      }
      const customerInfo = await Purchases.restorePurchases();
      await requestApi('/api/billing/restore', {
        method: 'POST',
        body: JSON.stringify(restorePayloadFromCustomerInfo(billing, customerInfo)),
      });
      await trackBillingEvent('restore_completed', { source: 'settings' });
      onChanged();
    } catch (err) {
      await trackBillingEvent('restore_failed', { source: 'settings', message: err instanceof Error ? err.message : 'unknown' });
      Alert.alert('Restore failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBillingBusy(false);
    }
  }

  async function exportData() {
    try {
      const data = await requestApi<UserDataExportView>('/api/me/export');
      await Share.share({
        title: 'Zen-Finance data export',
        message: JSON.stringify(data, null, 2),
      });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function shareReferral() {
    if (!referral) return;
    await Share.share({
      title: 'Join Zen-Finance',
      message: referral.shareText,
    });
  }

  async function redeemReferral() {
    if (!redeemCode.trim()) return;
    setReferralBusy(true);
    try {
      const res = await requestApi<ReferralRedeemView>('/api/referrals/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: redeemCode.trim().toUpperCase() }),
      });
      setReferral(res.referral);
      setRedeemCode('');
      onChanged();
      Alert.alert('Referral applied', 'Thirty days of Zen-Finance Coach credit was added.');
    } catch (err) {
      Alert.alert('Referral failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setReferralBusy(false);
    }
  }

  async function saveFreelancer() {
    if (!billing.isPremium) return;
    const tax = Math.min(50, Math.max(0, Math.round(Number(taxSetAside) || 0)));
    const runway = Math.min(24, Math.max(1, Math.round(Number(runwayTarget) || 3)));
    setFreelancerBusy(true);
    try {
      await requestApi('/api/freelancer/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: freelancer?.profile.enabled ?? true,
          targetMonthlyIncomeCents: dollarInputToCents(targetIncome),
          taxSetAsideBps: tax * 100,
          runwayTargetMonths: runway,
        }),
      });
      await loadFreelancer();
    } catch (err) {
      Alert.alert('Freelancer Mode', err instanceof Error ? err.message : 'Unable to save settings');
    } finally {
      setFreelancerBusy(false);
    }
  }

  async function toggleFreelancer(enabled: boolean) {
    if (!billing.isPremium) return;
    setFreelancerBusy(true);
    try {
      await requestApi('/api/freelancer/profile', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      await loadFreelancer();
    } catch (err) {
      Alert.alert('Freelancer Mode', err instanceof Error ? err.message : 'Unable to update Freelancer Mode');
    } finally {
      setFreelancerBusy(false);
    }
  }

  async function createHousehold() {
    setHouseholdBusy(true);
    try {
      const res = await requestApi<HouseholdStatusView>('/api/household', {
        method: 'POST',
        body: JSON.stringify({ name: 'Household' }),
      });
      setHousehold(res);
    } catch (err) {
      Alert.alert('Household Sharing', err instanceof Error ? err.message : 'Unable to create household');
    } finally {
      setHouseholdBusy(false);
    }
  }

  async function inviteHouseholdMember() {
    if (!householdInviteEmail.trim()) return;
    setHouseholdBusy(true);
    try {
      const res = await requestApi<HouseholdInviteCreatedView>('/api/household/invites', {
        method: 'POST',
        body: JSON.stringify({ email: householdInviteEmail.trim().toLowerCase() }),
      });
      setHouseholdInviteEmail('');
      await Share.share({ title: 'Join my Zen-Finance household', message: res.shareText });
      await loadHousehold();
    } catch (err) {
      Alert.alert('Invite failed', err instanceof Error ? err.message : 'Unable to create invite');
    } finally {
      setHouseholdBusy(false);
    }
  }

  async function acceptHouseholdInvite() {
    if (!householdInviteCode.trim()) return;
    setHouseholdBusy(true);
    try {
      const res = await requestApi<HouseholdStatusView>('/api/household/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: householdInviteCode.trim() }),
      });
      setHouseholdInviteCode('');
      setHousehold(res);
    } catch (err) {
      Alert.alert('Invite failed', err instanceof Error ? err.message : 'Unable to accept invite');
    } finally {
      setHouseholdBusy(false);
    }
  }

  async function createSharedGoal() {
    const target = dollarInputToCents(sharedGoalTarget);
    if (!sharedGoalName.trim() || !target) return;
    setHouseholdBusy(true);
    try {
      const res = await requestApi<HouseholdStatusView>('/api/household/goals', {
        method: 'POST',
        body: JSON.stringify({ name: sharedGoalName.trim(), targetAmountCents: target }),
      });
      setSharedGoalName('');
      setSharedGoalTarget('');
      setHousehold(res);
    } catch (err) {
      Alert.alert('Shared goal failed', err instanceof Error ? err.message : 'Unable to create shared goal');
    } finally {
      setHouseholdBusy(false);
    }
  }

  async function addHouseholdContribution(goalId: number) {
    const amount = dollarInputToCents(householdContribution[goalId] ?? '');
    if (!amount) return;
    setHouseholdBusy(true);
    try {
      const res = await requestApi<HouseholdStatusView>(`/api/household/goals/${goalId}/contributions`, {
        method: 'POST',
        body: JSON.stringify({ amountCents: amount }),
      });
      setHouseholdContribution((current) => ({ ...current, [goalId]: '' }));
      setHousehold(res);
    } catch (err) {
      Alert.alert('Contribution failed', err instanceof Error ? err.message : 'Unable to add contribution');
    } finally {
      setHouseholdBusy(false);
    }
  }

  function manageSubscription() {
    const url = safeAppStoreSubscriptionUrl(billing.entitlement?.managementUrl);
    if (!url) {
      Alert.alert('Subscription management', 'Manage your subscription from the App Store account used for purchase.');
      return;
    }
    void Linking.openURL(url).catch(() => {
      Alert.alert('Subscription management', 'Unable to open App Store subscription settings.');
    });
  }

  async function deleteAccount() {
    Alert.alert('Delete account', 'This permanently deletes your Zen-Finance data from the app database.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await requestApi('/api/me', { method: 'DELETE' });
            await clearRevenueCatIdentity();
            await SecureStore.deleteItemAsync(BUDGET_CONFIG_KEY).catch(() => {});
            await persistTokens(null);
            setTokens(null);
          } catch (err) {
            Sentry.captureException(err);
            Alert.alert('Deletion failed', err instanceof Error ? err.message : 'Your account was not deleted. Please try again.');
          }
        },
      },
    ]);
  }

  function openExternal(url: string) {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', 'Please try again in a moment.');
    });
  }

  const page = SETTINGS_SECTION_COPY[section];

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsDetailHeader}>
        <Pressable style={styles.settingsBackButton} accessibilityLabel="Back to profile" onPress={onBack}>
          <ChevronLeft color={theme.ink} size={22} />
        </Pressable>
        <View style={styles.flexShrink}>
          <Text style={styles.zenPageTitle}>{page.title}</Text>
          <Text style={styles.zenPageSubtitle}>{page.subtitle}</Text>
        </View>
      </View>
      {section === 'account' ? (
        <>
      <SectionHeader title="Account" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.settingsIdentityRow}>
          <View style={[styles.profileMenuIcon, { backgroundColor: theme.accentSoft }]}>
            <MaterialSymbol name="account_circle" color={theme.accent} size={20} />
          </View>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]} numberOfLines={1}>{accountProfile?.email ?? 'ZenFinance member'}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>
              {accountProfile
                ? `${accountProfile.signInMethods.map((method) => method === 'apple' ? 'Apple' : 'Password').join(' + ')} sign-in · member since ${dateLabel(accountProfile.createdAt)}`
                : 'Account details will appear when the service is available.'}
            </Text>
          </View>
        </View>
      </ZenGlass>
      <SectionHeader title="Billing" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <Crown color={billing.isPremium ? theme.gold : theme.muted} size={20} />
          <Text style={[styles.panelKicker, { color: billing.isPremium ? theme.gold : theme.muted }]}>
            {billing.isPremium ? 'Coach active' : 'Free plan'}
          </Text>
        </View>
        <Text style={[styles.panelBody, { color: theme.muted }]}>
          {billing.isPremium
            ? `${billing.plan} access · ${billing.entitlement?.expiresAt ? `renews or expires ${dateLabel(billing.entitlement.expiresAt)}` : 'lifetime or managed by store'}`
            : `Free includes ${billing.limits.maxLinkedItems} linked banks, ${billing.limits.maxActiveGoals} active goal, weekly briefs, and charge alerts.`}
        </Text>
        <SecondaryButton label={billingBusy ? 'Restoring...' : 'Restore purchases'} icon={RefreshCcw} disabled={billingBusy} onPress={restorePurchases} />
        {billing.isPremium ? <SecondaryButton label="Manage subscription" icon={CreditCard} onPress={manageSubscription} /> : null}
      </ZenGlass>
        </>
      ) : null}
      {section === 'referral' ? (
        <>
      <SectionHeader title="Invite Credit" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <Gift color={theme.accent} size={20} />
          <Text style={[styles.panelKicker, { color: theme.accent }]}>
            {referral?.code ?? 'Referral'}
          </Text>
        </View>
        <Text style={[styles.panelBody, { color: theme.muted }]}>
          {referral
            ? `${referral.referredUsers} redeemed invite(s) · ${referral.premiumDaysAwarded} premium day(s) awarded${referral.activeCreditExpiresAt ? ` · active until ${dateLabel(referral.activeCreditExpiresAt)}` : ''}`
            : 'Loading your invite code...'}
        </Text>
        <SecondaryButton label="Share invite" icon={Gift} disabled={!referral} onPress={shareReferral} />
        {!referral?.redeemedCode ? (
          <>
            <TextInput
              value={redeemCode}
              onChangeText={setRedeemCode}
              autoCapitalize="characters"
              placeholder="Referral code"
              placeholderTextColor={theme.muted}
              style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            />
            <SecondaryButton
              label={referralBusy ? 'Applying...' : 'Redeem code'}
              icon={CheckCircle2}
              disabled={referralBusy || !redeemCode.trim()}
              onPress={redeemReferral}
            />
          </>
        ) : (
          <Text style={[styles.rowDetail, { color: theme.muted }]}>Redeemed code {referral.redeemedCode}</Text>
        )}
      </ZenGlass>
        </>
      ) : null}
      {section === 'freelancer' ? (
        <>
      <SectionHeader title="Freelancer Mode" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <CircleDollarSign color={billing.isPremium ? theme.accent : theme.muted} size={20} />
          <Text style={[styles.panelKicker, { color: billing.isPremium ? theme.accent : theme.muted }]}>
            {billing.isPremium ? (freelancer?.profile.enabled === false ? 'Paused' : 'Active') : 'Coach only'}
          </Text>
        </View>
        {billing.isPremium ? (
          <>
            {freelancer ? (
              <>
                <StatusRail>
                  <MoneyMetric label="Avg income" value={usd(freelancer.avgMonthlyIncomeCents, true)} icon={CircleDollarSign} />
                  <MoneyMetric
                    label="Runway"
                    value={freelancer.runwayMonths === null ? 'N/A' : `${freelancer.runwayMonths.toFixed(1)} mo`}
                    icon={PiggyBank}
                  />
                </StatusRail>
                <StatusRail>
                  <MoneyMetric label="Set aside" value={usd(freelancer.estimatedTaxSetAsideMonthlyCents, true)} icon={Landmark} />
                  <MoneyMetric label="Target gap" value={usd(freelancer.targetMonthlyIncomeGapCents ?? 0, true)} icon={Target} />
                </StatusRail>
                <Toggle label="Freelancer Mode" value={freelancer.profile.enabled} onValueChange={toggleFreelancer} />
                <TextInput
                  value={targetIncome}
                  onChangeText={setTargetIncome}
                  keyboardType="number-pad"
                  placeholder="Monthly income target"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
                />
                <TextInput
                  value={taxSetAside}
                  onChangeText={setTaxSetAside}
                  keyboardType="number-pad"
                  placeholder="Estimated set-aside %"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
                />
                <TextInput
                  value={runwayTarget}
                  onChangeText={setRunwayTarget}
                  keyboardType="number-pad"
                  placeholder="Runway target months"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
                />
                <SecondaryButton
                  label={freelancerBusy ? 'Saving...' : 'Save Freelancer Mode'}
                  icon={CheckCircle2}
                  disabled={freelancerBusy}
                  onPress={saveFreelancer}
                />
                {freelancer.recommendations.slice(0, 2).map((rec) => (
                  <View key={`${rec.kind}-${rec.title}`} style={[styles.actionBox, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.actionTitle, { color: theme.ink }]}>{rec.title}</Text>
                    <Text style={[styles.actionMeta, { color: theme.muted }]}>{rec.body}</Text>
                  </View>
                ))}
              </>
            ) : (
              <SecondaryButton label="Load Freelancer Mode" icon={RefreshCcw} disabled={freelancerBusy} onPress={loadFreelancer} />
            )}
          </>
        ) : (
          <Text style={[styles.panelBody, { color: theme.muted }]}>
            Available with Zen-Finance Coach.
          </Text>
        )}
      </ZenGlass>
        </>
      ) : null}
      {section === 'household' ? (
        <>
      <SectionHeader title="Household Sharing" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <Users color={household?.household ? theme.accent : theme.muted} size={20} />
          <Text style={[styles.panelKicker, { color: household?.household ? theme.accent : theme.muted }]}>
            {household?.household ? `${household.household.members.length}/${household.household.seatLimit} seats` : 'Private by default'}
          </Text>
        </View>
        {household?.household ? (
          <>
            <Text style={[styles.panelBody, { color: theme.muted }]}>
              Shared goals are visible to household members. Bank accounts, transactions, chat, and personal goals stay individual.
            </Text>
            {household.household.members.map((member) => (
              <ZenGlass key={member.id} style={styles.settingsRowGlass}>
                <View style={[styles.smallIcon, { backgroundColor: theme.accentSoft }]}>
                  <Users color={theme.accent} size={18} />
                </View>
                <View style={styles.flexShrink}>
                  <Text style={[styles.rowTitle, { color: theme.ink }]}>{member.email}</Text>
                  <Text style={[styles.rowDetail, { color: theme.muted }]}>{member.role} · individual privacy zone</Text>
                </View>
              </ZenGlass>
            ))}
            {household.household.currentUserRole === 'owner' &&
            household.household.members.length + household.household.invites.length < household.household.seatLimit ? (
              <>
                <TextInput
                  value={householdInviteEmail}
                  onChangeText={setHouseholdInviteEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="Member email"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
                />
                <SecondaryButton
                  label={householdBusy ? 'Sending...' : 'Share invite'}
                  icon={UserPlus}
                  disabled={householdBusy || !householdInviteEmail.trim()}
                  onPress={inviteHouseholdMember}
                />
              </>
            ) : null}
            <TextInput
              value={sharedGoalName}
              onChangeText={setSharedGoalName}
              placeholder="Shared goal name"
              placeholderTextColor={theme.muted}
              style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            />
            <TextInput
              value={sharedGoalTarget}
              onChangeText={setSharedGoalTarget}
              keyboardType="number-pad"
              placeholder="Shared goal target"
              placeholderTextColor={theme.muted}
              style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            />
            <SecondaryButton
              label={householdBusy ? 'Saving...' : 'Create shared goal'}
              icon={Target}
              disabled={householdBusy || !sharedGoalName.trim() || !sharedGoalTarget.trim()}
              onPress={createSharedGoal}
            />
            {household.household.goals.map((goal) => (
              <View key={goal.id} style={[styles.actionBox, { backgroundColor: theme.accentSoft }]}>
                <View style={styles.panelHeader}>
                  <Home color={theme.accent} size={18} />
                  <Text style={[styles.actionTitle, { color: theme.ink }]}>{goal.name}</Text>
                </View>
                <Text style={[styles.actionMeta, { color: theme.muted }]}>
                  {usd(goal.currentAmountCents, true)} of {usd(goal.targetAmountCents, true)} · {Math.round(goal.progressRatio * 100)}%
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
                  <View style={[styles.progressFill, { width: `${Math.round(goal.progressRatio * 100)}%`, backgroundColor: theme.success }]} />
                </View>
                <View style={styles.inlineButtons}>
                  <TextInput
                    value={householdContribution[goal.id] ?? ''}
                    onChangeText={(value) => setHouseholdContribution((current) => ({ ...current, [goal.id]: value }))}
                    keyboardType="number-pad"
                    placeholder="Amount"
                    placeholderTextColor={theme.muted}
                    style={[styles.input, styles.flexShrink, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
                  />
                  <SecondaryButton
                    compact
                    label="Add"
                    icon={Plus}
                    disabled={householdBusy || !(householdContribution[goal.id] ?? '').trim()}
                    onPress={() => addHouseholdContribution(goal.id)}
                  />
                </View>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={[styles.panelBody, { color: theme.muted }]}>
              Create a two-seat household with Coach, or join one with an invite code.
            </Text>
            {billing.isPremium ? (
              <SecondaryButton
                label={householdBusy ? 'Creating...' : 'Create household'}
                icon={Home}
                disabled={householdBusy}
                onPress={createHousehold}
              />
            ) : null}
            <TextInput
              value={householdInviteCode}
              onChangeText={setHouseholdInviteCode}
              autoCapitalize="none"
              placeholder="Invite code"
              placeholderTextColor={theme.muted}
              style={[styles.input, { borderColor: theme.border, color: theme.ink, backgroundColor: theme.surface }]}
            />
            <SecondaryButton
              label={householdBusy ? 'Joining...' : 'Join household'}
              icon={UserPlus}
              disabled={householdBusy || !householdInviteCode.trim()}
              onPress={acceptHouseholdInvite}
            />
          </>
        )}
      </ZenGlass>
        </>
      ) : null}
      {section === 'notifications' ? (
        <>
      <SectionHeader title="Notifications" />
      <ZenGlass style={styles.settingsPanel}>
        <PrimaryButton label={prefs?.pushEnabled ? 'Push enabled' : 'Enable push notifications'} icon={Bell} onPress={registerPush} />
        {prefs ? (
          <>
            <Toggle label="Weekly brief" value={prefs.weeklyBrief} onValueChange={(v) => updatePrefs({ ...prefs, weeklyBrief: v })} />
            <Toggle label="Charge alerts" value={prefs.anomalies} onValueChange={(v) => updatePrefs({ ...prefs, anomalies: v })} />
            <Toggle label="Goal pacing" value={prefs.goalPacing} onValueChange={(v) => updatePrefs({ ...prefs, goalPacing: v })} />
            <Toggle label="Product updates" value={prefs.marketing} onValueChange={(v) => updatePrefs({ ...prefs, marketing: v })} />
          </>
        ) : null}
      </ZenGlass>
        </>
      ) : null}
      {section === 'banks' ? (
        <>
      <SectionHeader title="Linked Banks" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <ShieldCheck color={theme.accent} size={20} />
          <Text style={[styles.panelKicker, { color: theme.accent }]}>Read-only connections</Text>
        </View>
        <Text style={[styles.panelBody, { color: theme.muted }]}>ZenFinance reads balances and transactions to build your brief. It cannot move money.</Text>
      </ZenGlass>
      {items.length === 0 ? (
        <ZenGlass style={styles.settingsPanel}>
          <Text style={[styles.panelTitle, { color: theme.ink }]}>No banks linked</Text>
          <Text style={[styles.panelBody, { color: theme.muted }]}>Connect your first account to replace generic advice with a brief based on your real activity.</Text>
        </ZenGlass>
      ) : null}
      {items.map((item) => (
        <ZenGlass key={item.id} style={styles.settingsRowGlass}>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{item.institutionName ?? 'Bank'}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>
              {item.status.replace('_', ' ')} · {item.accounts.length} account(s) · synced {dateLabel(item.lastSyncedAt)}
            </Text>
          </View>
          <Pressable
            style={[styles.destructiveIconButton, { backgroundColor: theme.surfaceAlt }]}
            accessibilityRole="button"
            accessibilityLabel={`Disconnect ${item.institutionName ?? 'bank'}`}
            hitSlop={8}
            onPress={() => disconnect(item.id)}
          >
            <Trash2 color={theme.danger} size={20} />
          </Pressable>
        </ZenGlass>
      ))}
      <PrimaryButton label={items.length > 0 ? 'Connect another bank' : 'Connect a bank'} icon={Landmark} onPress={() => onNavigate('link')} />
        </>
      ) : null}
      {section === 'privacy' ? (
        <>
      <SectionHeader title="Security" />
      <ZenGlass style={styles.settingsPanel}>
        <View style={styles.panelHeader}>
          <ShieldCheck color={theme.accent} size={20} />
          <Text style={[styles.panelKicker, { color: theme.accent }]}>Private by default</Text>
        </View>
        <Text style={[styles.panelBody, { color: theme.muted }]}>Bank connections are read-only, credentials stay with Plaid, and sensitive screens are hidden when the app leaves the foreground.</Text>
      </ZenGlass>
      <SectionHeader title="Data Rights" />
      <SecondaryButton label="Export my data" icon={ShieldCheck} onPress={exportData} />
      <SecondaryButton label="Read privacy policy" icon={LockKeyhole} onPress={() => openExternal('https://zenfinance.rushingtechnologies.com/privacy')} />
      <SectionHeader title="Danger Zone" />
      <SecondaryButton label="Delete account" icon={Trash2} onPress={deleteAccount} danger />
        </>
      ) : null}
      {section === 'about' ? (
        <>
      <SectionHeader title="Help & Legal" />
      <SecondaryButton label="Help & support" icon={MessageCircle} onPress={() => openExternal('https://zenfinance.rushingtechnologies.com/support')} />
      <SecondaryButton label="Terms of service" icon={CreditCard} onPress={() => openExternal('https://zenfinance.rushingtechnologies.com/terms')} />
      <SectionHeader title="App Update" />
      <ZenGlass style={styles.settingsPanel}>
        <Text style={[styles.panelTitle, { color: theme.ink }]}>ZenFinance {Constants.expoConfig?.version ?? '0.1.1'}</Text>
        <Text style={[styles.updateMeta, { color: theme.muted }]}>{updateMeta}</Text>
        <SecondaryButton
          label={updateBusy ? 'Checking...' : 'Check for update'}
          icon={RefreshCcw}
          disabled={updateBusy}
          onPress={checkForUpdate}
        />
      </ZenGlass>
        </>
      ) : null}
    </ScrollView>
  );
}

function Toggle({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.rowTitle, { color: theme.ink }]}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.accent, false: theme.border }} />
    </View>
  );
}

function TabBar({ active, onChange, isPremium }: { active: TabKey; onChange: (tab: TabKey) => void; isPremium: boolean }) {
  const theme = useTheme();
  const tabs: Array<{ key: TabKey; icon: typeof Sparkles; label: string }> = [
    { key: 'brief', icon: Home, label: 'Home' },
    { key: 'transactions', icon: Wallet, label: 'Transactions' },
    { key: 'score', icon: Sparkles, label: 'Zen Score' },
    { key: 'coach', icon: Brain, label: 'Coach' },
    { key: 'profile', icon: UserRound, label: 'Profile' },
  ];
  return (
    <View style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.key;
        const locked = PREMIUM_TABS.has(tab.key) && !isPremium;
        return (
          <Pressable
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onChange(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={locked ? `${tab.label}, premium` : tab.label}
          >
            <View style={styles.tabIconWrap}>
              {selected ? (
                <View style={[styles.tabIconHalo, { backgroundColor: `${theme.accentBright}33`, shadowColor: theme.accentBright }]} />
              ) : null}
              <Icon color={selected ? theme.accentBright : theme.muted} size={selected ? 22 : 20} />
              <View
                style={[
                  styles.tabActiveBar,
                  { backgroundColor: selected ? theme.accentBright : 'transparent', shadowColor: theme.accentBright, shadowOpacity: selected ? 0.8 : 0 },
                ]}
              />
              {locked ? (
                <View style={[styles.tabLockBadge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <LockKeyhole color={theme.gold} size={9} strokeWidth={2.5} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabText, { color: selected ? theme.accentBright : theme.muted }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusRail({ children }: { children: ReactNode }) {
  return <View style={styles.statusRail}>{children}</View>;
}

function MoneyMetric({ label, value, icon: Icon }: { label: string; value: string; icon: IconComponent }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Icon color={theme.accent} size={18} />
      <Text
        style={[styles.metricValue, { color: theme.ink }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

function CoachCard({ children }: { children: ReactNode }) {
  return (
    <ZenGlass style={[styles.coachCard, { borderColor: '#48EFEF4D' }]}>
      {children}
    </ZenGlass>
  );
}

function InsightLedger({ facts }: { facts: ChatAnswerView['facts'] }) {
  const theme = useTheme();
  if (facts.length === 0) return null;
  return (
    <View style={[styles.insightLedger, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
      {facts.map((fact) => (
        <View key={`${fact.label}-${fact.source}`} style={styles.ledgerRow}>
          <Text style={[styles.ledgerLabel, { color: theme.muted }]} numberOfLines={1}>
            {fact.label}
          </Text>
          <Text style={[styles.ledgerValue, { color: theme.ink }]}>
            {fact.amountCents === null ? 'not available' : usd(fact.amountCents)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PlanOption({
  selected,
  featured,
  title,
  detail,
  price,
  onPress,
}: {
  selected: boolean;
  featured?: boolean;
  title: string;
  detail: string;
  price: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.planOption,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.accentSoft : featured ? theme.goldSoft : theme.surface,
        },
      ]}
      onPress={onPress}
      accessibilityLabel={`${title}, ${price}`}
      accessibilityState={{ selected }}
    >
      <View style={styles.flexShrink}>
        <View style={styles.planTitleRow}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
          {featured ? (
            <View style={[styles.planBadge, { backgroundColor: theme.gold }]}>
              <Text style={styles.planBadgeText}>Best value</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>{detail}</Text>
      </View>
      <Text style={[styles.amount, { color: selected ? theme.accent : theme.ink }]}>{price}</Text>
    </Pressable>
  );
}

function SectionBand({ children }: { children: ReactNode }) {
  return <ZenGlass style={styles.sectionBand}>{children}</ZenGlass>;
}

function EvidenceChip({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.evidenceChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <Text style={[styles.evidenceText, { color: theme.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>;
}

function ActionRow({ icon: Icon, title, detail, onPress }: { icon: IconComponent; title: string; detail: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable style={[styles.glassRow, onPress ? styles.actionRowInteractive : null]} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'none'}>
      <View style={[styles.smallIcon, { backgroundColor: theme.accentSoft }]}>
        <Icon color={theme.accent} size={18} />
      </View>
      <View style={styles.flexShrink}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>{detail}</Text>
      </View>
      <ChevronRight color={theme.muted} size={18} />
    </Pressable>
  );
}

function EmptyMini({ title, copy }: { title: string; copy: string }) {
  const theme = useTheme();
  return (
    <SectionBand>
      <Text style={[styles.panelTitle, { color: theme.ink }]}>{title}</Text>
      <Text style={[styles.panelBody, { color: theme.muted }]}>{copy}</Text>
    </SectionBand>
  );
}

function PrimaryButton({
  label,
  icon: Icon,
  disabled,
  compact,
  onPress,
}: {
  label: string;
  icon?: typeof Sparkles;
  disabled?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.98)).current;
  useEffect(() => {
    if (disabled || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.98, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [disabled, pulse, reduceMotion]);
  const contentColor = disabled ? theme.muted : '#06292A';
  return (
    <Animated.View style={[styles.primaryButtonPulse, compact ? styles.primaryButtonPulseCompact : null, { transform: [{ scale: disabled ? 1 : pulse }] }]}>
      <Pressable
        style={[styles.primaryButton, { backgroundColor: disabled ? theme.surfaceAlt : theme.accent }]}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        accessibilityLabel={label}
      >
        {Icon ? <Icon color={contentColor} size={18} /> : null}
        <Text style={[styles.primaryButtonText, { color: contentColor }]} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function SecondaryButton({
  label,
  icon: Icon,
  disabled,
  compact,
  danger,
  accent,
  onPress,
}: {
  label: string;
  icon?: typeof Sparkles;
  disabled?: boolean;
  compact?: boolean;
  danger?: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.secondaryButton,
        compact ? styles.compactButton : null,
        accent ? styles.accentButton : null,
        { borderColor: danger ? theme.danger : accent ? theme.accent : theme.border, backgroundColor: accent ? 'transparent' : theme.surface },
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={label}
    >
      {Icon ? <Icon color={danger ? theme.danger : theme.accent} size={17} /> : null}
      <Text style={[styles.secondaryButtonText, accent ? { color: theme.accent, fontWeight: '700' } : { color: danger ? theme.danger : theme.ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

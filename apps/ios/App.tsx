import * as Sentry from '@sentry/react-native';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import * as Updates from 'expo-updates';
import { StatusBar } from 'expo-status-bar';
import {
  Bell,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Crown,
  Coffee,
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
  ShoppingCart,
  ShieldCheck,
  Sprout,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  Volume2,
  WalletCards,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  type TextProps,
  useColorScheme,
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
import { create, open } from 'react-native-plaid-link-sdk';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { create as createStore } from 'zustand';
import { MONEY_PHYSICAL_PRODUCT_ID } from '@zenfinance/shared';
import type {
  AnomalyView,
  AuthTokens,
  BillingStatusView,
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
} from '@zenfinance/shared';

const API_URL: string = Constants.expoConfig?.extra?.apiUrl ?? 'https://api.zenfinance.rushingtechnologies.com';
const SENTRY_DSN: string | undefined = Constants.expoConfig?.extra?.sentryDsn;
const REVENUECAT_IOS_API_KEY: string | undefined = Constants.expoConfig?.extra?.revenueCatIosApiKey || undefined;
const OTA_DIAGNOSTIC_LABEL = 'Finance shell UI cleanup · 2026-07-12.2';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0.2,
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

type TabKey = 'brief' | 'coach' | 'transactions' | 'profile' | 'goals' | 'subs' | 'wins' | 'settings' | 'budget' | 'score';
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
  surface: '#FFFFFF14',
  surfaceAlt: '#FFFFFF0D',
  ink: '#FFFFFF',
  muted: '#FFFFFFB3',
  border: '#FFFFFF1A',
  accent: '#00D2D3',
  accentBright: '#8AFFFF',
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
  await SecureStore.setItemAsync('accessToken', tokens.accessToken);
  await SecureStore.setItemAsync('refreshToken', tokens.refreshToken);
}

let refreshPromise: Promise<AuthTokens | null> | null = null;

async function refreshAuthTokens(): Promise<AuthTokens | null> {
  refreshPromise ??= (async () => {
    const refreshToken = useAppStore.getState().refreshToken ?? (await SecureStore.getItemAsync('refreshToken'));
    if (!refreshToken) return null;
    const refresh = await fetch(`${API_URL}/api/auth/refresh`, {
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
  const res = await fetch(`${API_URL}${path}`, {
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

function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.globalText, style]} />;
}

function ZenBackdrop() {
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [phase]);

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
        </Defs>
        <Rect width="100%" height="100%" fill="#0B0E14" />
        <Ellipse cx="10%" cy="18%" rx="58%" ry="32%" fill="url(#tealGlow)" />
        <Ellipse cx="88%" cy="14%" rx="52%" ry="30%" fill="url(#violetGlow)" />
        <Ellipse cx="78%" cy="72%" rx="64%" ry="38%" fill="url(#blueGlow)" />
        <SvgCircle cx="20%" cy="82%" r="30%" fill="url(#violetGlow)" opacity="0.55" />
      </Svg>
      <Animated.View style={[styles.meshTeal, tealTransform]} />
      <Animated.View style={[styles.meshViolet, violetTransform]} />
    </View>
  );
}

function ZenGlass({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[styles.zenGlass, { borderColor: theme.border }, style]}>
      <BlurView intensity={18} tint="dark" style={styles.zenGlassBlur as any} />
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

function ZenLotus({ size = 18 }: { size?: number }) {
  const breathe = useRef(new Animated.Value(0.6)).current;
  // Unique gradient ids per instance so multiple lotuses on one screen (e.g.
  // profile avatar + score pill) don't collide on a shared def id.
  const uid = useRef(Math.random().toString(36).slice(2, 8)).current;
  const sid = `zl-s-${uid}`;
  const fid = `zl-f-${uid}`;
  const aid = `zl-a-${uid}`;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.6, duration: 2250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [breathe]);

  return (
    <Animated.View
      style={{ opacity: breathe }}
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

function ZenScorePill({ score }: { score: number }) {
  return (
    <ZenGlass style={styles.zenScorePill}>
      <View style={styles.zenScoreIcon}><ZenLotus size={15} /></View>
      <Text style={styles.zenScoreText}>Zen Score: {score}/100</Text>
      <View style={styles.zenScoreDot} />
    </ZenGlass>
  );
}

type IconComponent = typeof Sparkles;

export default function App() {
  const { accessToken, loading, setTokens, setLoading } = useAppStore();
  const theme = useTheme();
  const [fontsLoaded] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    void (async () => {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync('accessToken'),
        SecureStore.getItemAsync('refreshToken'),
      ]);
      setTokens(access && refresh ? { accessToken: access, refreshToken: refresh } : null);
      setLoading(false);
    })();
  }, [setLoading, setTokens]);

  if (loading || !fontsLoaded) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  return accessToken ? <ProductShell /> : <AuthScreen />;
}

function ZenOnboardingWelcome({ onStart }: { onStart: () => void }) {
  return (
    <SafeAreaView style={styles.onboardingScreen}>
      <ZenBackdrop />
      <Pressable style={styles.onboardingSkip} onPress={onStart}><Text style={styles.onboardingSkipText}>Skip</Text></Pressable>
      <View style={styles.onboardingHero}>
        <View style={styles.onboardingLotus}><ZenLotus size={88} /></View>
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
  const [transaction, setTransaction] = useState('"I spent $186 dining out this week"');
  const [brief, setBrief] = useState({
    action: 'Cap dining out at $100 to stay on track for your Japan trip goal.',
    impact: 'Potential impact: Save $45',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [touched, setTouched] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;
  const formValid = emailValid && passwordValid;
  const emailError = touched && email.length > 0 && !emailValid ? 'Enter a valid email address.' : null;
  const passwordError = touched && password.length > 0 && !passwordValid ? 'Use at least 8 characters.' : null;

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
          <Text style={styles.authBrandText}>ZenFinance</Text>
        </View>

        <Text style={styles.heroTitleV2}>
          Know what to do with your money today.
        </Text>
        <Text style={styles.heroCopyV2}>
          Link your accounts and get one plain-English move from your real transactions.
        </Text>

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
            placeholder={mode === 'register' ? 'Password (8+ characters)' : 'Password'}
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
          <Pressable
            style={styles.authModeToggle}
            onPress={() => {
              setMode((m) => (m === 'register' ? 'login' : 'register'));
              setTouched(false);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.authModeToggleText}>
              {mode === 'register' ? 'Already have an account? ' : 'New to ZenFinance? '}
              <Text style={styles.authModeToggleLink}>{mode === 'register' ? 'Sign in' : 'Create account'}</Text>
            </Text>
          </Pressable>
          <Text style={styles.disclosureV2}>Educational only. ZenFinance does not provide investment, tax, or legal advice.</Text>
        </View>

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
  const [tab, setTab] = useState<TabKey>('brief');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextHome, prefs] = await Promise.all([
        requestApi<MobileHomeSummaryView>('/api/mobile/home'),
        requestApi<NotificationPreferencesView>('/api/notifications/preferences'),
      ]);
      setHome(nextHome);
      setNotificationPrefs(prefs);
      setLoadError(null);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      return hasLinkedItems ? <BriefScreen home={home} onRefresh={refresh} refreshing={refreshing} onNavigate={setTab} /> : <LinkingScreen onLinked={refresh} onBudget={() => setTab('budget')} />;
    }
    if (PREMIUM_TABS.has(tab) && !home.billing.isPremium) {
      return <PaywallScreen billing={home.billing} home={home} source={tab} onChanged={refresh} />;
    }
    if (tab === 'coach') return <CoachScreen />;
    if (tab === 'transactions') return <TransactionsScreen home={home} onBack={() => setTab('brief')} onProfile={() => setTab('profile')} onConnect={() => setTab('brief')} onBudget={() => setTab('budget')} />;
    if (tab === 'profile') return <ZenProfileScreen billing={home.billing} onSettings={() => setTab('settings')} onScore={() => setTab('score')} onBudget={() => setTab('budget')} />;
    if (tab === 'budget') return <SmartBudgetingScreen home={home} />;
    if (tab === 'score') return <ZenScoreDetailsScreen home={home} />;
    if (tab === 'goals') return <GoalsScreen goals={home.goals} billing={home.billing} onChanged={refresh} />;
    if (tab === 'subs') return <SubscriptionsScreen audit={home.subscriptionAudit} onChanged={refresh} />;
    if (tab === 'wins') return <WinsScreen wins={home.moneyWins} moneyPhysical={home.moneyPhysical} billing={home.billing} anomalies={home.openAnomalies} onChanged={refresh} />;
    return <SettingsScreen items={home.items} billing={home.billing} onChanged={refresh} />;
  }, [home, loadError, refresh, refreshing, tab, theme.accent]);

  const isZenRoute = new Set<TabKey>(['brief', 'coach', 'transactions', 'profile', 'goals', 'budget', 'score']).has(tab);

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
                <Text style={[styles.appTitle, { color: theme.ink }]}>ZenFinance Coach</Text>
              </View>
              <Text style={[styles.appSub, { color: theme.muted }]}>
                {home && home.items.length > 0 ? latestSyncLabel(home.items) : 'ZenFinance money cockpit'}
              </Text>
            </View>
            <Pressable style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]} onPress={refresh}>
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
        {home ? <TabBar active={tab} onChange={setTab} isPremium={home.billing.isPremium} /> : null}
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

function LinkingScreen({ onLinked, onBudget }: { onLinked: () => void; onBudget: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  async function linkBank() {
    setBusy(true);
    try {
      const { linkToken } = await requestApi<{ linkToken: string }>('/api/link/token', { method: 'POST' });
      create({ token: linkToken });
      open({
        onSuccess: async (success) => {
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
          setBusy(false);
        },
        onExit: () => setBusy(false),
      });
    } catch (err) {
      Alert.alert('Link failed', err instanceof Error ? err.message : 'Unknown error');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Connect Bank</Text><Text style={styles.zenPageSubtitle}>Link securely in three calm steps</Text></View></View>
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
      <View style={styles.bankGrid}>{['Chase', 'Wells Fargo', 'Bank of America', 'Citibank', 'Capital One', 'US Bank'].map((name) => <Pressable key={name} style={styles.bankTile} onPress={linkBank}><Landmark color={theme.accent} size={18} /><Text style={styles.bankTileText}>{name}</Text></Pressable>)}</View>
      <ZenGlass style={styles.budgetEntryCard}>
        <View style={styles.budgetEntryIcon}><CircleDollarSign color={theme.violet} size={18} /></View>
        <View style={styles.flexShrink}><Text style={styles.budgetEntryTitle}>Preview Smart Budgeting</Text><Text style={styles.budgetEntryBody}>Explore the calm spending view before linking an account.</Text></View>
        <Pressable style={styles.budgetEntryButton} onPress={onBudget}><ChevronRight color="#0B0E14" size={16} /></Pressable>
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
  const [voiceBrief, setVoiceBrief] = useState<VoiceBriefView | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);

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
            <ZenLotus size={18} />
          </View>
          <Text style={styles.zenBrand}>ZenFinance</Text>
        </View>
        <Pressable style={styles.zenHeaderAction} onPress={onRefresh} accessibilityLabel="Refresh home">
          {refreshing ? <ActivityIndicator color={theme.accent} size="small" /> : <RefreshCcw color={theme.muted} size={17} />}
        </Pressable>
      </View>
      <ZenScorePill score={88} />
      {brief ? (
        <MoneyBriefHero
          home={home}
          brief={brief}
          voiceBrief={voiceBrief}
          voiceBusy={voiceBusy}
          speaking={speaking}
          onPlayVoice={playVoiceBrief}
          onStopVoice={stopVoiceBrief}
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
      {brief ? <DailyFocusCard brief={brief} /> : null}
      {brief ? <ZenDailyWidget brief={brief} /> : null}
      <StatusRail>
        <View style={styles.zenStatCard}>
          <Text style={styles.zenStatLabel}>Recent Activity</Text>
          <Text style={styles.zenStatValue}>{home.transactionCount}</Text>
          <Text style={styles.zenStatMeta}>transactions synced</Text>
        </View>
        <View style={styles.zenStatCard}>
          <Text style={styles.zenStatLabel}>Savings Goal</Text>
          <Text style={styles.zenStatValue}>{home.goals[0] ? `${Math.round(home.goals[0].pacing.progressRatio * 100)}%` : '0%'}</Text>
          <Text style={styles.zenStatMeta}>{home.goals[0]?.name ?? 'Set your first goal'}</Text>
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
      {home.recentTransactions.slice(0, 6).map((txn) => (
        <ZenGlass key={txn.id} style={styles.glassRow}>
          <View>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{txn.merchantClean ?? txn.merchantName ?? txn.name}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{dateLabel(txn.postedDate)} · {txn.category ?? 'uncategorized'}</Text>
          </View>
          <Text style={[styles.amount, { color: txn.amountCents > 0 ? theme.ink : theme.success }]}>{usd(txn.amountCents)}</Text>
        </ZenGlass>
      ))}
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
}: {
  home: MobileHomeSummaryView;
  brief: InsightView;
  voiceBrief: VoiceBriefView | null;
  voiceBusy: boolean;
  speaking: boolean;
  onPlayVoice: () => void;
  onStopVoice: () => void;
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
      <View style={styles.zenInsightFooter}>
        <Text style={styles.zenEvidence}>{home.transactionCount} transactions · {brief.headline}</Text>
        <Pressable onPress={home.billing.isPremium && voiceBrief ? onPlayVoice : () => feedback('up')}>
          <Volume2 color={home.billing.isPremium ? theme.accent : theme.muted} size={17} />
        </Pressable>
      </View>
      {home.billing.isPremium && voiceBrief ? (
        <View style={styles.zenVoiceRow}>
          <Text style={styles.zenDailyMeta}>{speaking ? 'Playing voice brief' : voiceBusy ? 'Preparing audio summary...' : `${Math.round(voiceBrief.durationSeconds / 6) / 10} min audio summary`}</Text>
          {speaking ? <Pressable onPress={onStopVoice}><Square color={theme.accent} size={16} /></Pressable> : null}
        </View>
      ) : null}
    </ZenGlass>
  );
}

function DailyFocusCard({ brief }: { brief: InsightView }) {
  const theme = useTheme();
  const [reviewed, setReviewed] = useState(false);

  async function reviewMove() {
    setReviewed(true);
    await requestApi(`/api/insights/${brief.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating: 'up' }),
    }).catch(() => {});
  }

  return (
    <ZenGlass style={styles.zenDailyCard}>
      <View style={styles.zenDailyCardHeader}>
        <View style={styles.zenDailyIcon}><Target color={theme.accent} size={19} /></View>
        <View style={styles.flexShrink}>
          <Text style={styles.zenDailyKicker}>DAILY FOCUS</Text>
          <Text style={styles.zenDailyCardTitle}>One calm move for today</Text>
        </View>
        <Text style={styles.zenDailyMeta}>{brief.action.timeframe}</Text>
      </View>
      <Text style={styles.zenDailyCardBody}>{brief.action.description}</Text>
      <PrimaryButton label={reviewed ? 'Move reviewed' : 'Review my move'} icon={CheckCircle2} disabled={reviewed} onPress={reviewMove} />
    </ZenGlass>
  );
}

function ZenDailyWidget({ brief }: { brief: InsightView }) {
  return (
    <ZenGlass style={styles.dailyWidget}>
      <View style={styles.dailyWidgetIcon}><Bell color="#00D2D3" size={16} /></View>
      <View style={styles.flexShrink}><Text style={styles.dailyWidgetTitle}>Good morning!</Text><Text style={styles.dailyWidgetBody}>{brief.action.description}</Text><Text style={styles.dailyWidgetBrand}>ZenFinance</Text></View>
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

function accountKindIcon(kind: string): typeof Landmark {
  switch (kind) {
    case 'Credit':
      return CreditCard;
    case 'Savings':
      return PiggyBank;
    default:
      return Landmark;
  }
}

function formatActivityCategory(txn: EnrichedTransactionView): string {
  const text = `${txn.category ?? ''} ${txn.merchantClean ?? txn.merchantName ?? txn.name}`.toLowerCase();
  if (text.includes('invest') || text.includes('vanguard') || text.includes('fidelity') || text.includes('robinhood')) return 'Growth/Investments';
  if (text.includes('dining') || text.includes('coffee') || text.includes('starbucks') || text.includes('restaurant')) return 'Dining';
  if (text.includes('shop') || text.includes('amazon') || text.includes('retail')) return 'Shopping';
  if (text.includes('util') || text.includes('comcast') || text.includes('electric') || text.includes('water')) return 'Utilities';
  return txn.category ?? 'General';
}

function activityIconForCategory(category: string): { icon: typeof Sprout; color: string; backgroundColor: string } {
  switch (category) {
    case 'Growth/Investments':
      return { icon: Sprout, color: '#75D38F', backgroundColor: '#75D38F24' };
    case 'Dining':
      return { icon: Coffee, color: '#E1AF7F', backgroundColor: '#E1AF7F24' };
    case 'Shopping':
      return { icon: ShoppingCart, color: '#AE8AEF', backgroundColor: '#AE8AEF24' };
    case 'Utilities':
      return { icon: Home, color: '#79B8F3', backgroundColor: '#79B8F324' };
    default:
      return { icon: CircleDollarSign, color: '#8FD8DA', backgroundColor: '#8FD8DA24' };
  }
}

function TransactionsScreen({ home, onBack, onProfile, onConnect, onBudget }: { home: MobileHomeSummaryView; onBack: () => void; onProfile: () => void; onConnect: () => void; onBudget: () => void }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
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
  const activityRows = home.recentTransactions.slice(0, 4);

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.transactionsScreenScroll} showsVerticalScrollIndicator={false}>
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
          const Icon = accountKindIcon(kind);
          const displayName = account.name || item.institutionName || kind;
          const ending = account.mask ? `Ending in ${account.mask}` : item.institutionName ? item.institutionName : 'Connected account';
          const balance = account.currentBalanceCents == null ? '$0.00' : usd(account.currentBalanceCents, true);
          const featured = index === 0;
          return (
            <ZenGlass key={key} style={[styles.accountCard, featured ? styles.accountCardFeatured : null]}>
              <Text style={styles.accountCardEyebrow}>{kind}</Text>
              <View style={[styles.accountCardIcon, featured ? styles.accountCardIconFeatured : null]}>
                <Icon color={featured ? theme.accent : theme.ink} size={26} strokeWidth={1.75} />
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
        <Pressable onPress={() => scrollRef.current?.scrollToEnd({ animated: true })} accessibilityLabel="See all activity">
          <Text style={styles.activitySeeAll}>See all</Text>
        </Pressable>
      </View>
      <View style={styles.transactionList}>
        {activityRows.map((txn, index) => {
          const category = formatActivityCategory(txn);
          const { icon: Icon, color, backgroundColor } = activityIconForCategory(category);
          const amountColor = txn.amountCents < 0 ? '#FF6B99' : theme.accent;
          const merchant = txn.merchantClean ?? txn.merchantName ?? txn.name;
          const date = dateLabel(txn.postedDate);
          return (
            <ZenGlass key={txn.id} style={styles.activityTile}>
              <View style={[styles.activityIcon, { backgroundColor, borderColor: `${color}40` }]}>
                <Icon color={color} size={20} strokeWidth={1.9} />
              </View>
              <View style={styles.activityCopy}>
                <Text style={styles.activityTitle}>{category}</Text>
                <Text style={styles.activityMerchant}>{merchant}</Text>
                <Text style={styles.activityDate}>{index === 2 ? `${date}\n${date}` : date}</Text>
              </View>
              <Text style={[styles.activityAmount, { color: amountColor }]}>{usd(txn.amountCents)}</Text>
            </ZenGlass>
          );
        })}
      </View>
      {home.recentTransactions.length === 0 ? <Text style={styles.zenEmptyText}>No recent transactions yet.</Text> : null}
      <Pressable style={styles.transactionsBudgetLink} onPress={onBudget}>
        <CircleDollarSign color={theme.violet} size={17} />
        <Text style={styles.transactionsBudgetText}>Open Smart Budgeting</Text>
        <ChevronRight color={theme.muted} size={16} />
      </Pressable>
      <PrimaryButton label="Connect another account" icon={Landmark} onPress={onConnect} />
    </ScrollView>
  );
}

function ZenProfileScreen({ billing, onSettings, onScore, onBudget }: { billing: BillingStatusView; onSettings: () => void; onScore: () => void; onBudget: () => void }) {
  const theme = useTheme();
  const rows = [
    { label: 'Settings', icon: SlidersHorizontal, onPress: onSettings },
    { label: 'Security', icon: LockKeyhole, onPress: onSettings },
    { label: 'Linked Banks', icon: Landmark, onPress: onSettings },
    { label: 'Notifications', icon: Bell, onPress: onSettings },
    { label: 'Smart Budgeting', icon: CircleDollarSign, onPress: onBudget },
  ];
  return (
    <ScrollView contentContainerStyle={styles.zenProfileScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.profileTopBack}><ChevronRight color={theme.muted} size={18} style={{ transform: [{ rotate: '180deg' }] }} /><Text style={styles.zenPageSubtitle}>Profile</Text></View>
      <View style={styles.profileAvatar}><ZenLotus size={38} /></View>
      <Text style={styles.profileName}>ZenFinance Member</Text>
      <Text style={styles.profileRole}>{billing.isPremium ? 'Zen Master' : 'Finding your balance'}</Text>
      <Pressable style={styles.profileScore} onPress={onScore}><ZenLotus size={18} /><Text style={styles.profileScoreText}>Zen Score</Text><Text style={styles.profileScoreValue}>88/100</Text><ChevronRight color={theme.muted} size={16} /></Pressable>
      <ZenGlass style={styles.profileMenu}>
        {rows.map((row, index) => {
          const Icon = row.icon;
          return <Pressable key={row.label} style={[styles.profileMenuRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]} onPress={row.onPress}><Icon color={theme.muted} size={18} /><Text style={styles.profileMenuText}>{row.label}</Text><ChevronRight color={theme.muted} size={17} /></Pressable>;
        })}
      </ZenGlass>
      <SecondaryButton label="Open full settings" icon={SlidersHorizontal} onPress={onSettings} />
    </ScrollView>
  );
}

function SmartBudgetingScreen({ home }: { home: MobileHomeSummaryView }) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [budgetTarget, setBudgetTarget] = useState('3000');
  const [draftBudgetTarget, setDraftBudgetTarget] = useState('3000');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [roundupsEnabled, setRoundupsEnabled] = useState(false);
  const [categoryCaps, setCategoryCaps] = useState<Record<string, number>>({});
  const categories = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const txn of home.recentTransactions) {
      const key = txn.category ?? 'Essentials';
      grouped.set(key, (grouped.get(key) ?? 0) + Math.abs(txn.amountCents));
    }
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [home.recentTransactions]);
  const total = categories.reduce((sum, [, amount]) => sum + amount, 0);
  const targetCents = Math.max(0, Math.round(Number(budgetTarget.replace(/[$,\s]/g, '')) * 100) || 0);
  const availableCents = Math.max(0, targetCents - total);

  function openEditor() {
    setDraftBudgetTarget(budgetTarget);
    setEditing(true);
  }

  function saveBudget() {
    const next = Number(draftBudgetTarget.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(next) || next <= 0) return;
    setBudgetTarget(String(Math.round(next)));
    setEditing(false);
  }

  function adjustCategoryCap(category: string, amountCents: number, delta: number) {
    setCategoryCaps((current) => {
      const currentCap = current[category] ?? Math.max(50, Math.round(amountCents / 100));
      return { ...current, [category]: Math.max(25, currentCap + delta) };
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Smart Budgeting</Text><Text style={styles.zenPageSubtitle}>A softer way to see your spending</Text></View><Pressable style={styles.zenEditButton} onPress={editing ? () => setEditing(false) : openEditor}><Text style={styles.zenHeaderEdit}>{editing ? 'Cancel' : 'Edit'}</Text></Pressable></View>
      {editing ? <ZenGlass style={styles.budgetEditPanel}><Text style={styles.budgetEditTitle}>Monthly budget</Text><Text style={styles.budgetEditBody}>Set the amount you want to keep available after planned spending.</Text><TextInput value={draftBudgetTarget} onChangeText={setDraftBudgetTarget} keyboardType="decimal-pad" placeholder="$3,000" placeholderTextColor={theme.muted} style={styles.budgetInput} /><View style={styles.budgetEditActions}><SecondaryButton label="Cancel" compact onPress={() => setEditing(false)} /><PrimaryButton label="Save budget" icon={CheckCircle2} onPress={saveBudget} /></View></ZenGlass> : null}
      <ZenGlass style={styles.budgetHero}>
        <View style={styles.budgetRing}><Text style={styles.budgetHeroAmount}>{usd(availableCents, true)}</Text><Text style={styles.budgetHeroMeta}>Available Funds</Text></View>
        <View style={styles.budgetLegend}><View style={styles.legendLine}><View style={[styles.legendDot, { backgroundColor: theme.accent }]} /><Text style={styles.budgetLegendText}>Essentials</Text></View><View style={styles.legendLine}><View style={[styles.legendDot, { backgroundColor: theme.violet }]} /><Text style={styles.budgetLegendText}>Flexible</Text></View></View>
      </ZenGlass>
      <ZenGlass style={styles.budgetControls}>
        <View style={styles.budgetControlHeader}><Text style={styles.budgetControlTitle}>Budget rhythm</Text><Text style={styles.budgetControlMeta}>{period === 'monthly' ? 'Resets monthly' : 'Resets weekly'}</Text></View>
        <View style={styles.budgetSegmented}><Pressable style={[styles.budgetSegment, period === 'monthly' ? styles.budgetSegmentActive : null]} onPress={() => setPeriod('monthly')}><Text style={[styles.budgetSegmentText, period === 'monthly' ? styles.budgetSegmentTextActive : null]}>Monthly</Text></Pressable><Pressable style={[styles.budgetSegment, period === 'weekly' ? styles.budgetSegmentActive : null]} onPress={() => setPeriod('weekly')}><Text style={[styles.budgetSegmentText, period === 'weekly' ? styles.budgetSegmentTextActive : null]}>Weekly</Text></Pressable></View>
        <View style={styles.budgetToggleRow}><View style={styles.flexShrink}><Text style={styles.budgetToggleTitle}>Mindful alerts</Text><Text style={styles.budgetToggleMeta}>Nudge me before a category runs hot</Text></View><Switch value={alertsEnabled} onValueChange={setAlertsEnabled} trackColor={{ false: '#FFFFFF26', true: theme.accent }} thumbColor="#FFFFFF" /></View>
        <View style={styles.budgetToggleRow}><View style={styles.flexShrink}><Text style={styles.budgetToggleTitle}>Round-up buffer</Text><Text style={styles.budgetToggleMeta}>Move spare change into savings</Text></View><Switch value={roundupsEnabled} onValueChange={setRoundupsEnabled} trackColor={{ false: '#FFFFFF26', true: theme.violet }} thumbColor="#FFFFFF" /></View>
      </ZenGlass>
      <Text style={styles.zenSectionLabel}>SPENDING FLOW</Text>
      <View style={styles.budgetBubbleGrid}>
        {categories.map(([category, amount], index) => <View key={category} style={[styles.budgetBubble, index === 0 ? styles.budgetBubbleLarge : null, { borderColor: index % 2 ? theme.violet : theme.accent }]}><Text style={styles.budgetBubbleName}>{category}</Text><Text style={styles.budgetBubbleAmount}>{usd(amount, true)}</Text><Text style={styles.budgetBubbleMeta}>{total ? `${Math.round((amount / total) * 100)}%` : '0%'}</Text></View>)}
      </View>
      <Text style={styles.zenSectionLabel}>CATEGORY CAPS</Text>
      <ZenGlass style={styles.categoryCapsPanel}>{categories.map(([category, amount], index) => { const cap = categoryCaps[category] ?? Math.max(50, Math.round(amount / 100)); return <View key={category} style={[styles.categoryCapRow, index > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}><View style={styles.flexShrink}><Text style={styles.categoryCapName}>{category}</Text><Text style={styles.categoryCapMeta}>Spent {usd(amount, true)}</Text></View><Pressable style={styles.capButton} onPress={() => adjustCategoryCap(category, amount, -50)}><Minus color={theme.muted} size={14} /></Pressable><Text style={styles.categoryCapValue}>${cap}</Text><Pressable style={styles.capButton} onPress={() => adjustCategoryCap(category, amount, 50)}><Plus color={theme.accent} size={14} /></Pressable></View>; })}</ZenGlass>
      <ZenGlass style={styles.budgetInsight}><Sparkles color={theme.accent} size={18} /><View style={styles.flexShrink}><Text style={styles.budgetInsightTitle}>A gentle nudge</Text><Text style={styles.budgetInsightBody}>Your essentials are steady. Keep one flexible category open for joy.</Text></View></ZenGlass>
    </ScrollView>
  );
}

function ZenScoreDetailsScreen({ home }: { home: MobileHomeSummaryView }) {
  const theme = useTheme();
  const goalProgress = home.goals[0] ? Math.round(home.goals[0].pacing.progressRatio * 100) : 85;
  const metrics = [
    ['Mindful Spending', 'Great job staying within budget.', `${Math.min(100, goalProgress + 4)}%`, CircleDollarSign],
    ['Growth & Savings', 'You are building a consistent rhythm.', `${Math.max(0, goalProgress - 2)}%`, PiggyBank],
    ['Consistency', 'Small steps are becoming a habit.', '85%', CheckCircle2],
  ] as const;
  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Zen Score Details</Text><Text style={styles.zenPageSubtitle}>Your progress, reflected</Text></View><SlidersHorizontal color={theme.muted} size={18} /></View>
      <ZenGlass style={styles.scoreHero}><Text style={styles.zenScoreEyebrow}>ZEN SCORE</Text><ZenLotus size={84} /><Text style={styles.scoreHeroNumber}>88</Text><Text style={styles.scoreHeroMeta}>Your financial wellness is blooming.</Text></ZenGlass>
      <View style={styles.scoreMetricStack}>{metrics.map(([name, copy, value, Icon], index) => <ZenGlass key={name} style={styles.scoreMetric}><View style={styles.scoreMetricIcon}><Icon color={index === 1 ? theme.violet : theme.accent} size={18} /></View><View style={styles.flexShrink}><Text style={styles.scoreMetricName}>{name}</Text><Text style={styles.scoreMetricCopy}>{copy}</Text></View><Text style={styles.scoreMetricValue}>{value}</Text></ZenGlass>)}</View>
    </ScrollView>
  );
}

function ZenMilestoneCard({ goal }: { goal: GoalView }) {
  return (
    <ZenGlass style={styles.milestoneCard}>
      <Text style={styles.milestoneTitle}>Milestone Reached!</Text>
      <Text style={styles.milestoneSubtitle}>{goal.name}</Text>
      <View style={styles.milestoneLotus}><ZenLotus size={72} /></View>
      <Text style={styles.milestoneBody}>You’re making steady progress. Take a breath and celebrate this step.</Text>
      <PrimaryButton label="Continue the Journey" icon={ChevronRight} onPress={() => {}} />
    </ZenGlass>
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

function CoachScreen() {
  const theme = useTheme();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<ChatAnswerView[]>([]);

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
      setAnswers((items) => [...items, answer]);
      await requestApi('/api/app-events', {
        method: 'POST',
        body: JSON.stringify({ name: 'coach:asked_question' }),
      }).catch(() => {});
    } catch (err) {
      Alert.alert('Coach failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.coachScreenHeader}><View><Text style={styles.zenPageTitle}>Zen AI Coach</Text><Text style={styles.zenPageSubtitle}>A calm place to ask anything about your money</Text></View><View style={styles.chatStatus}><View style={styles.zenScoreDot} /><Text style={styles.chatStatusText}>Online</Text></View></View>
      <FlatList
        data={answers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        ListEmptyComponent={
          <CoachPromptBoard onPress={setQuestion} />
        }
        renderItem={({ item }) => <ChatBubble answer={item} />}
      />
      <View style={[styles.quickPromptRail, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <QuickPromptChip label="Can I afford..." value="Can I afford $600 this month?" onPress={setQuestion} />
        <QuickPromptChip label="Find waste" value="Which subscriptions should I cancel?" onPress={setQuestion} />
        <QuickPromptChip label="Explain charge" value="Explain my largest unusual charge this month." onPress={setQuestion} />
      </View>
      <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <TextInput
          style={[styles.composerInput, { color: theme.ink }]}
          placeholder="Ask the coach"
          placeholderTextColor={theme.muted}
          value={question}
          onChangeText={setQuestion}
          returnKeyType="send"
          onSubmitEditing={ask}
        />
        <Pressable style={[styles.sendButton, { backgroundColor: theme.accent }]} disabled={busy} onPress={ask}>
          {busy ? <ActivityIndicator color="#fff" /> : <Send color="#fff" size={18} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatBubble({ answer }: { answer: ChatAnswerView }) {
  const theme = useTheme();
  return (
    <CoachCard>
      <View style={styles.chatBubbleHeader}>
        <View style={styles.chatBubbleIcon}><ZenLotus size={16} /></View>
        <Text style={styles.chatBubbleKicker}>ZEN AI</Text>
      </View>
      <Text style={[styles.panelBody, { color: theme.ink }]}>{answer.answer}</Text>
      <InsightLedger facts={answer.facts} />
      {answer.actions.map((action) => (
        <Text key={action} style={[styles.actionMeta, { color: theme.accent }]}>→ {action}</Text>
      ))}
    </CoachCard>
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
      <ZenGlass style={styles.chatMessageBubble}>
        <View style={styles.chatBubbleHeader}><View style={styles.chatBubbleIcon}><ZenLotus size={16} /></View><Text style={styles.chatBubbleKicker}>ZEN AI</Text></View>
        <Text style={styles.chatMessageText}>Good evening! Based on your spending this month, you’re on track. I found one small move that could help you reach your goal faster.</Text>
      </ZenGlass>
      <ZenGlass style={styles.chatMessageBubble}>
        <View style={styles.chatBubbleHeader}><View style={styles.chatBubbleIcon}><ZenLotus size={16} /></View><Text style={styles.chatBubbleKicker}>ZEN AI</Text></View>
        <Text style={styles.chatMessageText}>Ask me about a charge, a goal, or what you can comfortably spend next.</Text>
      </ZenGlass>
      <ZenGlass style={styles.coachInsightsCard}>
        <Text style={styles.coachInsightsTitle}>Your Path to Zen</Text>
        <Text style={styles.coachInsightsSubtitle}>Recent milestones</Text>
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
  const [storePackages, setStorePackages] = useState<RevenueCatPackage[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(billing.packages[1]?.productId ?? billing.packages[0]?.productId);
  const [busy, setBusy] = useState<string | null>(null);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);

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
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>ZenFinance Coach</Text><Text style={styles.zenPageSubtitle}>A calmer way to make your next money move</Text></View><Crown color={theme.gold} size={19} /></View>
      <ZenGlass style={styles.paywallHero}>
        <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
          <Crown color={theme.accent} size={36} />
        </View>
        <Text style={[styles.panelTitle, { color: theme.ink }]}>Keep the dollars ZenFinance already found.</Text>
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

function GoalsScreen({ goals, billing, onChanged }: { goals: GoalView[]; billing: BillingStatusView; onChanged: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [scenario, setScenario] = useState<WhatIfResultView | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const atFreeGoalLimit = !billing.isPremium && goals.filter((goal) => goal.status === 'active').length >= (billing.limits.maxActiveGoals ?? Number.POSITIVE_INFINITY);

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

  async function runScenario(goalId?: number) {
    if (!billing.isPremium) return;
    try {
      setScenario(
        await requestApi<WhatIfResultView>('/api/what-if', {
          method: 'POST',
          body: JSON.stringify({ goalId, monthlySpendReductionCents: 15000, oneTimeSavingsCents: 2500 }),
        }),
      );
    } catch (err) {
      Alert.alert('Simulation failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Zen Savings Goals</Text><Text style={styles.zenPageSubtitle}>Small steps, meaningful progress</Text></View><Target color={theme.accent} size={19} /></View>
      {goals[0] ? <ZenGlass style={styles.goalsSummary}><View style={styles.goalsSummaryHeader}><View style={styles.goalsSummaryIcon}><PiggyBank color={theme.accent} size={18} /></View><Text style={styles.goalsSummaryName}>{goals[0].name}</Text><Text style={styles.goalsSummaryPercent}>{Math.round(goals[0].pacing.progressRatio * 100)}%</Text></View><Text style={styles.goalsSummaryAmount}>{usd(goals[0].currentAmountCents, true)} <Text style={styles.goalsSummaryTarget}>of {usd(goals[0].targetAmountCents, true)}</Text></Text><View style={styles.goalProgressTrack}><View style={[styles.goalProgressFill, { width: `${Math.min(100, Math.max(0, goals[0].pacing.progressRatio * 100))}%` }]} /></View></ZenGlass> : null}
      <SectionHeader title="Your Goals" />
      {goals.find((goal) => goal.pacing.progressRatio >= 0.5) ? <ZenMilestoneCard goal={goals.find((goal) => goal.pacing.progressRatio >= 0.5)!} /> : null}
      {goals.map((goal) => (
        <ZenGlass key={goal.id} style={styles.goalCardGlass}>
          <Text style={[styles.panelTitle, { color: theme.ink }]}>{goal.name}</Text>
          <Text style={[styles.panelBody, { color: theme.muted }]}>{goalCoachSentence(goal)}</Text>
          <StatusRail>
            <MoneyMetric label="Current" value={usd(goal.currentAmountCents, true)} icon={PiggyBank} />
            <MoneyMetric label="Target" value={usd(goal.targetAmountCents, true)} icon={Target} />
            <MoneyMetric label="Pace" value={pacingLabel(goal.pacing.pacingStatus)} icon={SlidersHorizontal} />
          </StatusRail>
          <ProgressBar value={goal.pacing.progressRatio} />
          <Text style={[styles.rowDetail, { color: theme.muted }]}>
            {usd(goal.currentAmountCents, true)} of {usd(goal.targetAmountCents, true)} · {goal.pacing.pacingStatus.replace('_', ' ')}
          </Text>
          <Text style={[styles.factLine, { color: theme.muted }]}>
            Projected completion: {dateLabel(goal.pacing.projectedCompletionDate)}
          </Text>
          <SecondaryButton
            label={billing.isPremium ? 'Run $150/mo what-if' : 'Unlock what-if'}
            icon={SlidersHorizontal}
            onPress={() => (billing.isPremium ? runScenario(goal.id) : setShowPaywall(true))}
          />
        </ZenGlass>
      ))}
      {scenario ? (
        <SectionBand>
          <View style={styles.panelHeader}>
            <SlidersHorizontal color={theme.accent} size={20} />
            <Text style={[styles.panelKicker, { color: theme.accent }]}>What-if scenario</Text>
          </View>
          <Text style={[styles.panelBody, { color: theme.muted }]}>{scenario.narration}</Text>
          <StatusRail>
            <MoneyMetric label="Weekly net" value={usd(scenario.weeklyNetChangeCents, true)} icon={CircleDollarSign} />
            <MoneyMetric label="One-time" value={usd(scenario.oneTimeSavingsCents, true)} icon={PiggyBank} />
            <MoneyMetric label="Monthly cut" value={usd(scenario.monthlySpendReductionCents, true)} icon={CreditCard} />
          </StatusRail>
          {scenario.projections.slice(0, 2).map((projection) => (
            <View key={projection.goalId} style={[styles.scenarioRow, { borderColor: theme.border }]}>
              <View style={styles.flexShrink}>
                <Text style={[styles.rowTitle, { color: theme.ink }]}>{projection.name}</Text>
                <Text style={[styles.rowDetail, { color: theme.muted }]}>
                  {dateLabel(projection.currentProjectedCompletionDate)} → {dateLabel(projection.simulatedProjectedCompletionDate)}
                </Text>
              </View>
              <Text style={[styles.amount, { color: theme.success }]}>
                {projection.weeksFaster === null ? 'Updated' : `${projection.weeksFaster}w faster`}
              </Text>
            </View>
          ))}
        </SectionBand>
      ) : null}
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
  return value.replace('_', ' ');
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
  const [physicalBusy, setPhysicalBusy] = useState<string | null>(null);
  const [physicalProduct, setPhysicalProduct] = useState<RevenueCatStoreProduct | null>(null);
  const [physicalMessage, setPhysicalMessage] = useState<string | null>(null);

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
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{win.status} · {dateLabel(win.createdAt)}</Text>
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

function SettingsScreen({ items, billing, onChanged }: { items: LinkedItem[]; billing: BillingStatusView; onChanged: () => void }) {
  const theme = useTheme();
  const prefs = useAppStore((s) => s.notificationPrefs);
  const setPrefs = useAppStore((s) => s.setNotificationPrefs);
  const setTokens = useAppStore((s) => s.setTokens);
  const [billingBusy, setBillingBusy] = useState(false);
  const [referral, setReferral] = useState<ReferralStatusView | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [referralBusy, setReferralBusy] = useState(false);
  const [freelancer, setFreelancer] = useState<FreelancerSummaryView | null>(null);
  const [freelancerBusy, setFreelancerBusy] = useState(false);
  const [targetIncome, setTargetIncome] = useState('');
  const [taxSetAside, setTaxSetAside] = useState('25');
  const [runwayTarget, setRunwayTarget] = useState('3');
  const [household, setHousehold] = useState<HouseholdStatusView | null>(null);
  const [householdBusy, setHouseholdBusy] = useState(false);
  const [householdInviteEmail, setHouseholdInviteEmail] = useState('');
  const [householdInviteCode, setHouseholdInviteCode] = useState('');
  const [sharedGoalName, setSharedGoalName] = useState('');
  const [sharedGoalTarget, setSharedGoalTarget] = useState('');
  const [householdContribution, setHouseholdContribution] = useState<Record<number, string>>({});
  const [updateBusy, setUpdateBusy] = useState(false);

  const updateMeta = [
    `Build marker: ${OTA_DIAGNOSTIC_LABEL}`,
    `Channel: ${Updates.channel ?? 'embedded'}`,
    `Runtime: ${Updates.runtimeVersion ?? 'unknown'}`,
    `Update ID: ${Updates.updateId ?? 'embedded'}`,
  ].join('\n');

  useEffect(() => {
    requestApi<ReferralStatusView>('/api/referrals/me')
      .then(setReferral)
      .catch(() => setReferral(null));
  }, []);

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
    void loadFreelancer();
  }, [loadFreelancer]);

  const loadHousehold = useCallback(async () => {
    try {
      setHousehold(await requestApi<HouseholdStatusView>('/api/household'));
    } catch {
      setHousehold(null);
    }
  }, []);

  useEffect(() => {
    void loadHousehold();
  }, [loadHousehold]);

  async function registerPush() {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;
    const token = await Notifications.getExpoPushTokenAsync();
    const next = await requestApi<NotificationPreferencesView>('/api/push-tokens', {
      method: 'POST',
      body: JSON.stringify({ token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
    });
    setPrefs(next);
  }

  async function updatePrefs(next: NotificationPreferencesView) {
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
      Alert.alert('Update ready', 'ZenFinance will restart now to apply the latest bundle.', [
        { text: 'Restart', onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (err) {
      Alert.alert('Update check failed', err instanceof Error ? err.message : 'Unable to check for updates.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function disconnect(itemId: number) {
    await requestApi(`/api/items/${itemId}`, { method: 'DELETE' });
    onChanged();
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
        title: 'ZenFinance data export',
        message: JSON.stringify(data, null, 2),
      });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function shareReferral() {
    if (!referral) return;
    await Share.share({
      title: 'Join ZenFinance',
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
      Alert.alert('Referral applied', 'Thirty days of ZenFinance Coach credit was added.');
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
      await Share.share({ title: 'Join my ZenFinance household', message: res.shareText });
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
    const url = billing.entitlement?.managementUrl;
    if (!url) {
      Alert.alert('Subscription management', 'Manage your subscription from the App Store account used for purchase.');
      return;
    }
    void Linking.openURL(url);
  }

  async function signOut() {
    const refreshToken = useAppStore.getState().refreshToken;
    if (refreshToken) {
      await requestApi('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => {});
    }
    await clearRevenueCatIdentity();
    await persistTokens(null);
    setTokens(null);
  }

  async function deleteAccount() {
    Alert.alert('Delete account', 'This permanently deletes your ZenFinance data from the app database.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await requestApi('/api/me', { method: 'DELETE' });
          await clearRevenueCatIdentity();
          await persistTokens(null);
          setTokens(null);
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.zenScreenScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.zenPageHeader}><View><Text style={styles.zenPageTitle}>Settings</Text><Text style={styles.zenPageSubtitle}>Keep your ZenFinance space in balance</Text></View><SlidersHorizontal color={theme.muted} size={18} /></View>
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
            Available with ZenFinance Coach.
          </Text>
        )}
      </ZenGlass>
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
      <SectionHeader title="Notifications" />
      <ZenGlass style={styles.settingsPanel}>
        <PrimaryButton label={prefs?.pushEnabled ? 'Push enabled' : 'Enable push notifications'} icon={Bell} onPress={registerPush} />
        {prefs ? (
          <>
            <Toggle label="Weekly brief" value={prefs.weeklyBrief} onValueChange={(v) => updatePrefs({ ...prefs, weeklyBrief: v })} />
            <Toggle label="Charge alerts" value={prefs.anomalies} onValueChange={(v) => updatePrefs({ ...prefs, anomalies: v })} />
            <Toggle label="Goal pacing" value={prefs.goalPacing} onValueChange={(v) => updatePrefs({ ...prefs, goalPacing: v })} />
          </>
        ) : null}
      </ZenGlass>
      <SectionHeader title="Linked Banks" />
      {items.map((item) => (
        <ZenGlass key={item.id} style={styles.settingsRowGlass}>
          <View>
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
      <SectionHeader title="Data Rights" />
      <SecondaryButton label="Export my data" icon={ShieldCheck} onPress={exportData} />
      <SectionHeader title="App Update" />
      <ZenGlass style={styles.settingsPanel}>
        <Text style={[styles.updateMeta, { color: theme.muted }]}>{updateMeta}</Text>
        <SecondaryButton
          label={updateBusy ? 'Checking...' : 'Check for update'}
          icon={RefreshCcw}
          disabled={updateBusy}
          onPress={checkForUpdate}
        />
      </ZenGlass>
      <SecondaryButton label="Sign out" icon={LogOut} onPress={signOut} />
      <SecondaryButton label="Delete account" icon={Trash2} onPress={deleteAccount} danger />
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
    { key: 'brief', icon: Home, label: 'Overview' },
    { key: 'transactions', icon: WalletCards, label: 'Accounts' },
    { key: 'coach', icon: MessageCircle, label: 'AI Coach' },
    { key: 'budget', icon: CircleDollarSign, label: 'Budget' },
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
            style={[
              styles.tabItem,
              selected ? [styles.tabItemActive, { backgroundColor: theme.accentSoft, borderColor: theme.accent }] : null,
            ]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={locked ? `${tab.label}, premium` : tab.label}
          >
            <View style={styles.tabIconWrap}>
              <Icon color={selected ? theme.accent : theme.muted} size={selected ? 22 : 20} />
              {locked ? (
                <View style={[styles.tabLockBadge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <LockKeyhole color={theme.gold} size={9} strokeWidth={2.5} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabText, { color: selected ? theme.ink : theme.muted }]} numberOfLines={1}>
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
      <Text style={[styles.metricValue, { color: theme.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

function CoachCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ZenGlass style={[styles.coachCard, styles.violetChatGlow, { borderColor: theme.violet }]}>
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
    <Pressable style={[styles.glassRow, onPress ? styles.actionRowInteractive : null]} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}>
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
  onPress,
}: {
  label: string;
  icon?: typeof Sparkles;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.98)).current;
  useEffect(() => {
    if (disabled) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.98, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [disabled, pulse]);
  const contentColor = disabled ? theme.muted : '#fff';
  return (
    <Animated.View style={[styles.primaryButtonPulse, { transform: [{ scale: disabled ? 1 : pulse }] }]}>
      <Pressable
        style={[styles.primaryButton, { backgroundColor: disabled ? theme.surfaceAlt : theme.accent }]}
        disabled={disabled}
        onPress={onPress}
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
  onPress,
}: {
  label: string;
  icon?: typeof Sparkles;
  disabled?: boolean;
  compact?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={[
        styles.secondaryButton,
        compact ? styles.compactButton : null,
        { borderColor: danger ? theme.danger : theme.border, backgroundColor: theme.surface },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      {Icon ? <Icon color={danger ? theme.danger : theme.accent} size={17} /> : null}
      <Text style={[styles.secondaryButtonText, { color: danger ? theme.danger : theme.ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  globalText: { fontFamily: 'Inter_400Regular', letterSpacing: 0 },
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerGrow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authScreen: { flex: 1 },
  onboardingScreen: { flex: 1, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 24, justifyContent: 'space-between', backgroundColor: '#0B0E14' },
  onboardingSkip: { alignSelf: 'flex-end', padding: 8 },
  onboardingSkipText: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 12 },
  onboardingHero: { alignItems: 'center', gap: 18 },
  onboardingLotus: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8E44AD26', shadowColor: '#00D2D3', shadowOpacity: 0.5, shadowRadius: 34, shadowOffset: { width: 0, height: 0 } },
  onboardingTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 31, lineHeight: 36, textAlign: 'center', letterSpacing: 0.5 },
  onboardingBody: { maxWidth: 290, color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  authContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  authContentV2: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, gap: 14 },
  authBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  authLogo: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF1A', backgroundColor: '#FFFFFF0D' },
  authBrandText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  appScreen: { flex: 1 },
  content: { flex: 1 },
  zenBackdrop: StyleSheet.absoluteFill,
  meshTeal: { position: 'absolute', width: 260, height: 220, left: -80, top: 80, borderRadius: 140, backgroundColor: '#00D2D31A' },
  meshViolet: { position: 'absolute', width: 300, height: 250, right: -100, top: 20, borderRadius: 160, backgroundColor: '#8E44AD1A' },
  zenFrame: { flex: 1, marginHorizontal: 12, marginTop: 8, marginBottom: 8, borderRadius: 28, borderWidth: 1, borderColor: '#FFFFFF26', overflow: 'hidden' },
  zenHomeScroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 24, gap: 14 },
  zenHomeHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  zenLotusMark: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  zenBrand: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  zenHeaderAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  zenScorePill: { alignSelf: 'center', minHeight: 34, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  zenScoreCard: { alignItems: 'center', paddingVertical: 18, gap: 3, borderColor: '#FFFFFF38' },
  zenScoreAura: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00D2D31A', shadowColor: '#00D2D3', shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  zenScoreEyebrow: { color: '#FFFFFF99', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 2, marginTop: 5 },
  zenScoreNumber: { color: '#FFFFFF', fontFamily: 'Inter_300Light', fontSize: 34, letterSpacing: 1 },
  zenScoreDenom: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 15, letterSpacing: 0 },
  zenScoreCaption: { color: '#79E6B0', fontFamily: 'Inter_500Medium', fontSize: 10 },
  zenScoreIcon: { width: 22, height: 22, borderRadius: 7, backgroundColor: '#FFFFFF33', alignItems: 'center', justifyContent: 'center' },
  zenScoreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  zenScoreDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#79E6B0' },
  zenGlass: { backgroundColor: '#FFFFFF0D', borderWidth: 1, borderRadius: 24, padding: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 32, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  zenGlassBlur: StyleSheet.absoluteFill,
  zenGlassTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#FFFFFF0D', borderRadius: 24 },
  primaryButtonPulse: { width: '100%' },
  zenInsightCard: { gap: 12, borderColor: '#FFFFFF38' },
  zenInsightHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zenInsightIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  zenInsightKicker: { color: '#00D2D3', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  zenImpact: { color: '#FFFFFFB3', fontSize: 11, fontWeight: '800' },
  zenInsightTitle: { color: '#FFFFFF', fontSize: 27, lineHeight: 31, fontFamily: 'Inter_300Light', letterSpacing: 1 },
  zenInsightBody: { color: '#FFFFFFB3', fontSize: 13, lineHeight: 18 },
  zenDailyFocus: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#00D2D314', borderWidth: 1, borderColor: '#00D2D34D' },
  zenDailyCard: { gap: 12, borderColor: '#00D2D34D', shadowColor: '#00D2D3', shadowOpacity: 0.18, shadowRadius: 22 },
  zenDailyCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  zenDailyIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  zenDailyCardTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 15, marginTop: 3 },
  zenDailyCardBody: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  dailyWidget: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderColor: '#00D2D34D', backgroundColor: '#00D2D314' },
  dailyWidgetIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  dailyWidgetTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  dailyWidgetBody: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, marginTop: 2 },
  dailyWidgetBrand: { color: '#00D2D3', fontFamily: 'Inter_500Medium', fontSize: 9, marginTop: 3 },
  zenDailyKicker: { color: '#00D2D3', fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  zenDailyText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 4 },
  zenDailyMeta: { color: '#FFFFFF99', fontSize: 11, lineHeight: 16, marginTop: 4 },
  zenSwapButton: { minHeight: 32, borderRadius: 16, paddingHorizontal: 11, justifyContent: 'center', backgroundColor: '#FFFFFFB3' },
  zenSwapText: { color: '#0B0E14', fontSize: 10, fontWeight: '900' },
  zenInsightFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zenEvidence: { flex: 1, color: '#FFFFFF80', fontSize: 10 },
  zenVoiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  zenStatCard: { flex: 1, minHeight: 82, padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF1A', gap: 2 },
  zenStatLabel: { color: '#FFFFFFB3', fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  zenStatValue: { color: '#FFFFFF', fontSize: 20, fontFamily: 'Inter_600SemiBold' },
  zenStatMeta: { color: '#FFFFFF80', fontSize: 10 },
  zenLinkGrid: { flexDirection: 'row', gap: 10 },
  zenLinkCard: { flex: 1, minHeight: 88, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF0D', borderWidth: 1, borderColor: '#FFFFFF1A', gap: 4 },
  zenLinkTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  zenLinkMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10 },
  zenScreenScroll: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 28, gap: 14 },
  zenPageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  zenPageTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 21, letterSpacing: 0.4 },
  zenPageSubtitle: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  zenHeaderAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF1A' },
  zenSectionLabel: { color: '#FFFFFF80', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.5, marginTop: 4 },
  transactionsScreenScroll: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 28, gap: 14 },
  transactionsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 },
  transactionsHeaderIconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  transactionsHeaderTitle: { flex: 1, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 25, textAlign: 'center' },
  transactionsHeaderAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#00D2D34D', backgroundColor: '#00D2D320', shadowColor: '#00D2D3', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  transactionsSectionTitle: { color: '#7CD0D3', fontFamily: 'Inter_600SemiBold', fontSize: 24, marginTop: 8, marginBottom: 2 },
  activityHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  activitySeeAll: { color: '#8FA1B5', fontFamily: 'Inter_500Medium', fontSize: 16 },
  accountRail: { gap: 14, paddingRight: 16, paddingTop: 8 },
  accountCard: { width: 157, minHeight: 194, padding: 16, gap: 4, borderRadius: 22 },
  accountCardFeatured: { borderColor: '#8FD8DA66', shadowColor: '#8FD8DA', shadowOpacity: 0.38, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  accountCardEyebrow: { color: '#FFFFFFB3', fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 4 },
  accountCardIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  accountCardIconFeatured: { backgroundColor: '#8FD8DA26', borderWidth: 1, borderColor: '#8FD8DA66' },
  accountCardName: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 18, lineHeight: 20 },
  accountCardSubtitle: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 18 },
  accountCardEnding: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  accountCardAmount: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: 'auto' },
  transactionList: { gap: 10, marginTop: 2 },
  activityTile: { minHeight: 86, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  activityCopy: { flex: 1, minWidth: 0 },
  activityTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 20, lineHeight: 23 },
  activityMerchant: { color: '#9DA8BA', fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 19, marginTop: 2 },
  activityDate: { color: '#8A95A3', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 16, marginTop: 2 },
  activityAmount: { fontFamily: 'Inter_500Medium', fontSize: 23, marginLeft: 10, textAlign: 'right' },
  transactionPanel: { paddingVertical: 4 },
  transactionRow: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  transactionIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center' },
  transactionName: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  transactionMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3 },
  transactionAmount: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  transactionsBudgetLink: { minHeight: 48, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#8E44AD14', borderWidth: 1, borderColor: '#8E44AD4D', flexDirection: 'row', alignItems: 'center', gap: 8 },
  transactionsBudgetText: { flex: 1, color: '#FFFFFFB3', fontFamily: 'Inter_500Medium', fontSize: 12 },
  insightPanel: { gap: 12 },
  settingsPanel: { gap: 12 },
  settingsRowGlass: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalCardGlass: { gap: 12 },
  moneyPhysicalHero: { gap: 12 },
  moneyWinsHero: { gap: 6 },
  paywallHero: { gap: 12, borderColor: '#8E44AD66', shadowColor: '#8E44AD', shadowOpacity: 0.32, shadowRadius: 28 },
  auditCard: { gap: 10 },
  zenEmptyText: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 12, paddingVertical: 18 },
  profileTopBack: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  profileAvatar: { width: 94, height: 94, borderRadius: 47, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: '#00D2D326', borderWidth: 2, borderColor: '#00D2D3', shadowColor: '#00D2D3', shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  profileName: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 21, textAlign: 'center', marginTop: 10 },
  profileRole: { color: '#00D2D3', fontFamily: 'Inter_500Medium', fontSize: 11, textAlign: 'center', marginTop: 3 },
  profileScore: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF1A', marginTop: 12 },
  profileScoreText: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 11 },
  profileScoreValue: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  profileMenu: { paddingVertical: 4, marginTop: 8 },
  profileMenuRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  profileMenuText: { flex: 1, color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 13 },
  zenProfileScroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, gap: 10 },
  zenHeaderEdit: { color: '#00D2D3', fontFamily: 'Inter_500Medium', fontSize: 12 },
  zenEditButton: { minHeight: 32, minWidth: 48, alignItems: 'flex-end', justifyContent: 'center' },
  budgetHero: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 16 },
  budgetRing: { width: 142, height: 142, borderRadius: 71, borderWidth: 10, borderColor: '#00D2D366', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF0D', shadowColor: '#00D2D3', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  budgetHeroAmount: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 23 },
  budgetHeroMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 3 },
  budgetLegend: { flexDirection: 'row', gap: 16 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  budgetLegendText: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 10 },
  budgetBubbleGrid: { minHeight: 290, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10 },
  budgetBubble: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#FFFFFF14', borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: 8 },
  budgetBubbleLarge: { width: 132, height: 132, borderRadius: 66 },
  budgetBubbleName: { color: '#FFFFFFB3', fontFamily: 'Inter_500Medium', fontSize: 10, textAlign: 'center' },
  budgetBubbleAmount: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 4 },
  budgetBubbleMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 2 },
  budgetInsight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  budgetInsightTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  budgetInsightBody: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  budgetEditPanel: { gap: 10, borderColor: '#00D2D34D' },
  budgetEditTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  budgetEditBody: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  budgetInput: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: '#FFFFFF26', backgroundColor: '#FFFFFF0D', color: '#FFFFFF', paddingHorizontal: 13, fontFamily: 'Inter_500Medium', fontSize: 16 },
  budgetEditActions: { flexDirection: 'row', gap: 8 },
  budgetControls: { gap: 10 },
  budgetControlHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  budgetControlTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  budgetControlMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10 },
  budgetSegmented: { flexDirection: 'row', minHeight: 36, padding: 3, borderRadius: 12, backgroundColor: '#FFFFFF0D', gap: 3 },
  budgetSegment: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  budgetSegmentActive: { backgroundColor: '#00D2D326', borderWidth: 1, borderColor: '#00D2D34D' },
  budgetSegmentText: { color: '#FFFFFF80', fontFamily: 'Inter_500Medium', fontSize: 11 },
  budgetSegmentTextActive: { color: '#FFFFFF' },
  budgetToggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  budgetToggleTitle: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  budgetToggleMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3 },
  categoryCapsPanel: { paddingVertical: 4 },
  categoryCapRow: { minHeight: 58, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryCapName: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  categoryCapMeta: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3 },
  capButton: { width: 28, height: 28, borderRadius: 10, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center' },
  categoryCapValue: { width: 48, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center' },
  scoreHero: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 5, borderColor: '#8E44AD66', shadowColor: '#8E44AD', shadowOpacity: 0.35, shadowRadius: 28 },
  scoreHeroNumber: { color: '#FFFFFF', fontFamily: 'Inter_300Light', fontSize: 52, lineHeight: 56, marginTop: -8 },
  scoreHeroMeta: { color: '#FFFFFF99', fontFamily: 'Inter_400Regular', fontSize: 11 },
  scoreMetricStack: { gap: 10 },
  scoreMetric: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18 },
  scoreMetricIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center' },
  scoreMetricName: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  scoreMetricCopy: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 3 },
  scoreMetricValue: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  goalsSummary: { gap: 10, borderColor: '#00D2D34D' },
  goalsSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalsSummaryIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  goalsSummaryName: { flex: 1, color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 12 },
  goalsSummaryPercent: { color: '#00D2D3', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  goalsSummaryAmount: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 22 },
  goalsSummaryTarget: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 11 },
  goalProgressTrack: { height: 8, borderRadius: 4, backgroundColor: '#FFFFFF14', overflow: 'hidden' },
  goalProgressFill: { height: '100%', borderRadius: 4, backgroundColor: '#00D2D3' },
  connectSteps: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginVertical: 4 },
  connectStep: { alignItems: 'center', gap: 5 },
  connectStepDot: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, borderColor: '#FFFFFF40', alignItems: 'center', justifyContent: 'center' },
  connectStepActive: { backgroundColor: '#00D2D3', borderColor: '#00D2D3' },
  connectStepNumber: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  connectStepText: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 9 },
  bankGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bankTile: { width: '31%', minHeight: 70, borderRadius: 18, backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF26', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 7, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  bankTileText: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 9, textAlign: 'center' },
  budgetEntryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderColor: '#8E44AD66' },
  budgetEntryIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#8E44AD33', alignItems: 'center', justifyContent: 'center' },
  budgetEntryTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  budgetEntryBody: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 3 },
  budgetEntryButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFFB3', alignItems: 'center', justifyContent: 'center' },
  milestoneCard: { alignItems: 'center', gap: 8, borderColor: '#8E44AD66', shadowColor: '#8E44AD', shadowOpacity: 0.45, shadowRadius: 30 },
  milestoneTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 24, textAlign: 'center' },
  milestoneSubtitle: { color: '#00D2D3', fontFamily: 'Inter_500Medium', fontSize: 11, textAlign: 'center' },
  milestoneLotus: { width: 130, height: 130, borderRadius: 65, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8E44AD26', marginVertical: 8 },
  milestoneBody: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  brandMark: { marginBottom: 16 },
  heroTitle: { fontSize: 40, fontWeight: '800' },
  heroTitleV2: { color: '#FFFFFF', fontSize: 36, lineHeight: 39, fontWeight: '300', textAlign: 'left', marginTop: 18 },
  heroAccent: { color: '#FFFFFF' },
  heroCopy: { fontSize: 17, lineHeight: 25, marginTop: 10, marginBottom: 28 },
  heroCopyV2: { color: '#FFFFFFB3', fontSize: 16, lineHeight: 24, textAlign: 'left', marginBottom: 4 },
  authPanel: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 10 },
  authPanelV2: { borderWidth: 1, borderRadius: 24, backgroundColor: '#FFFFFF14', borderColor: '#FFFFFF1A', padding: 14, gap: 10, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  authInputV2: { minHeight: 48, borderWidth: 1, borderRadius: 14, borderColor: '#FFFFFF1A', backgroundColor: '#FFFFFF0D', color: '#FFFFFF', paddingHorizontal: 14, fontSize: 15 },
  inputLabel: { fontSize: 13, fontWeight: '800', marginBottom: -4 },
  disclosure: { fontSize: 12, lineHeight: 18, marginTop: 18 },
  disclosureV2: { color: '#FFFFFF99', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  demoPanel: { borderWidth: 1, borderColor: '#FFFFFF1A', borderRadius: 24, backgroundColor: '#FFFFFF14', padding: 14, gap: 10, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  demoLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  demoInput: { minHeight: 48, borderWidth: 1, borderColor: '#FFFFFF1A', borderRadius: 14, backgroundColor: '#FFFFFF0D', color: '#FFFFFF', paddingHorizontal: 14, fontSize: 15 },
  demoButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#00D2D3', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  demoButtonText: { color: '#0B0E14', fontSize: 15, fontWeight: '800' },
  generatedBrief: { borderWidth: 1, borderColor: '#00D2D34D', borderRadius: 20, backgroundColor: '#00D2D326', padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  generatedCheck: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#00D2D3', alignItems: 'center', justifyContent: 'center' },
  generatedTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  generatedBody: { color: '#FFFFFFB3', fontSize: 14, lineHeight: 20, marginTop: 4 },
  generatedImpact: { color: '#00D2D3', fontSize: 14, lineHeight: 20, fontWeight: '900', marginTop: 2 },
  authProofGrid: { flexDirection: 'row', gap: 10 },
  authProofCard: { flex: 1, minHeight: 126, borderWidth: 1, borderColor: '#FFFFFF1A', borderRadius: 20, backgroundColor: '#FFFFFF14', padding: 12 },
  authProofKicker: { color: '#00D2D3', fontSize: 10, lineHeight: 14, fontWeight: '900', textTransform: 'uppercase' },
  authProofTitle: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontWeight: '900', marginTop: 6 },
  authProofBody: { color: '#FFFFFFB3', fontSize: 12, lineHeight: 17, marginTop: 6 },
  topBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#FFFFFF1A', backgroundColor: '#0B0E14B3' },
  appTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tinyLogo: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  appTitle: { fontSize: 24, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  appSub: { fontSize: 13, marginTop: 2 },
  iconButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF1A' },
  shellRail: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#0B0E14B3', borderBottomWidth: 1, borderBottomColor: '#FFFFFF1A' },
  coachConsole: { borderWidth: 1, borderRadius: 24, padding: 12, gap: 10, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  consoleHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  consoleStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  consoleChip: { minHeight: 30, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF0D' },
  consoleChipText: { fontSize: 12, fontWeight: '800' },
  consoleDot: { width: 7, height: 7, borderRadius: 4 },
  consoleAskPill: { minHeight: 42, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, shadowColor: '#00D2D3', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  consoleAskText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  consoleNextAction: { minHeight: 70, borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF0D' },
  consoleActionKicker: { fontSize: 11, lineHeight: 15, fontWeight: '900', textTransform: 'uppercase' },
  consoleActionText: { fontSize: 14, lineHeight: 20, fontWeight: '900' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, fontSize: 15 },
  primaryButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, shadowColor: '#00D2D3', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  primaryButtonText: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  secondaryButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  compactButton: { minHeight: 38, flex: 1 },
  secondaryButtonText: { flexShrink: 1, fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  largeIcon: { width: 72, height: 72, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  emptyCopy: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  statusRail: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, minHeight: 82, borderWidth: 1, borderRadius: 8, padding: 12, gap: 4 },
  metricValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 12, fontWeight: '700' },
  primaryPanel: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 12, backgroundColor: '#FFFFFF0D', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 32, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  sectionBand: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 12, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelKicker: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  panelTitle: { fontSize: 20, lineHeight: 26, fontFamily: 'Inter_300Light', letterSpacing: 1 },
  panelBody: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_400Regular' },
  briefHeroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  impactPill: { minWidth: 82, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  impactValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  impactLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceChip: { maxWidth: '100%', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  evidenceText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  voiceInline: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  actionBox: { borderRadius: 16, padding: 14, gap: 4, borderWidth: 1, borderColor: '#00D2D34D' },
  actionRowInteractive: { backgroundColor: '#FFFFFF0D', borderRadius: 16, paddingHorizontal: 10 },
  glassRow: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionTitle: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  actionMeta: { fontSize: 13, lineHeight: 18 },
  inlineButtons: { flexDirection: 'row', gap: 10 },
  featureList: { gap: 9 },
  featureLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  planOption: { minHeight: 68, borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  planBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginTop: 10 },
  row: { minHeight: 64, borderBottomWidth: 1, paddingVertical: 12, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 12 },
  destructiveIconButton: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rowDetail: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_400Regular', marginTop: 2 },
  updateMeta: { fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  smallIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabBar: { marginHorizontal: 12, marginBottom: Platform.OS === 'ios' ? 12 : 8, borderWidth: 1, borderRadius: 22, flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 7, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10, backgroundColor: '#FFFFFF14' },
  tabItem: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 0, borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  tabItemActive: { shadowColor: '#00D2D3', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  tabText: { fontSize: 11, fontWeight: '800' },
  tabIconWrap: { position: 'relative' },
  tabLockBadge: { position: 'absolute', top: -6, right: -10, width: 15, height: 15, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  loadErrorTitle: { textAlign: 'center', marginTop: 16 },
  loadErrorBody: { textAlign: 'center', marginTop: 8, marginBottom: 20, paddingHorizontal: 24 },
  authModeTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 2 },
  authInputError: { borderColor: '#FF7A9A' },
  authFieldError: { color: '#FF7A9A', fontSize: 12, marginTop: -4, marginLeft: 4 },
  authModeToggle: { alignItems: 'center', paddingVertical: 6 },
  authModeToggleText: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 13 },
  authModeToggleLink: { color: '#00D2D3', fontFamily: 'Inter_600SemiBold' },
  txnEmptyCta: { alignItems: 'center', gap: 8, padding: 20, marginTop: 8 },
  txnEmptyTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 4 },
  txnEmptyBody: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
  chatList: { flexGrow: 1, padding: 20, gap: 10 },
  coachCard: { borderWidth: 1, borderRadius: 24, padding: 14, gap: 8, marginBottom: 10, shadowColor: '#8E44AD', shadowOpacity: 0.38, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  violetChatGlow: { backgroundColor: '#8E44AD14' },
  chatBubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  chatBubbleIcon: { width: 26, height: 26, borderRadius: 9, backgroundColor: '#8E44AD33', alignItems: 'center', justifyContent: 'center' },
  chatBubbleKicker: { color: '#FFFFFFB3', fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  chatPageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  coachScreenHeader: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chatStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chatStatusText: { color: '#79E6B0', fontFamily: 'Inter_400Regular', fontSize: 10 },
  chatMessageBubble: { alignSelf: 'stretch', gap: 8, borderColor: '#8E44AD66', backgroundColor: '#8E44AD14', shadowColor: '#8E44AD', shadowOpacity: 0.35, shadowRadius: 24 },
  chatMessageText: { color: '#FFFFFFB3', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  chatPromptLabel: { color: '#FFFFFF80', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.5, marginTop: 4 },
  coachInsightsCard: { alignSelf: 'stretch', gap: 8, borderColor: '#00D2D34D' },
  coachInsightsTitle: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  coachInsightsSubtitle: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 10 },
  coachInsightRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  coachInsightIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  coachInsightTitle: { color: '#FFFFFF', fontFamily: 'Inter_500Medium', fontSize: 11 },
  coachInsightCopy: { color: '#FFFFFF80', fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 2 },
  promptBoard: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', paddingVertical: 24, gap: 12 },
  promptGroup: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  quickPromptRail: { borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  quickPromptChip: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  quickPromptText: { fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center' },
  insightLedger: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  ledgerLabel: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  ledgerValue: { fontSize: 12, lineHeight: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  factLine: { fontSize: 12, lineHeight: 17 },
  suggestion: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, width: '100%' },
  suggestionText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  composer: { borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  composerInput: { flex: 1, minHeight: 44, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: '#00D2D3', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  progressTrack: { height: 10, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8 },
  scenarioRow: { minHeight: 58, borderTopWidth: 1, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bigNumber: { fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rightStack: { alignItems: 'flex-end', gap: 4 },
  linkText: { fontSize: 12, fontWeight: '800' },
  toggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

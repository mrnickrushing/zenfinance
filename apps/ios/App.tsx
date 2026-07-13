import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import * as Updates from 'expo-updates';
import { StatusBar } from 'expo-status-bar';
import {
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Crown,
  Flower2,
  Gift,
  Home,
  Landmark,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Moon,
  PiggyBank,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trash2,
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
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
  Easing,
} from 'react-native';
import {
  Circle as SvgCircle,
  Defs,
  Ellipse,
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
  LinkedItem,
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

type TabKey = 'brief' | 'coach' | 'goals' | 'subs' | 'wins' | 'settings';
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

function ZenBackdrop() {
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
    </View>
  );
}

function ZenGlass({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return <View style={[styles.zenGlass, { borderColor: theme.border }, style]}>{children}</View>;
}

function ZenLotus({ size = 18 }: { size?: number }) {
  const breathe = useRef(new Animated.Value(0.72)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.72, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [breathe]);

  return (
    <Animated.View style={{ opacity: breathe }}>
      <Flower2 color={midnightZen.accent} size={size} strokeWidth={1.6} />
    </Animated.View>
  );
}

type IconComponent = typeof Sparkles;

export default function App() {
  const { accessToken, loading, setTokens, setLoading } = useAppStore();
  const theme = useTheme();

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

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  return accessToken ? <ProductShell /> : <AuthScreen />;
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

  async function submit(path: 'register' | 'login') {
    setBusy(true);
    try {
      const tokens = await requestApi<AuthTokens>(
        `/api/auth/${path}`,
        { method: 'POST', body: JSON.stringify({ email, password }) },
        false,
      );
      await persistTokens(tokens);
      setTokens(tokens);
      void requestApi('/api/app-events', {
        method: 'POST',
        body: JSON.stringify({ name: path === 'register' ? 'onboarding:registered' : 'onboarding:logged_in' }),
      }).catch(() => {});
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
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
          <TextInput
            style={styles.authInputV2}
            placeholder="Email"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.authInputV2}
            placeholder="Password"
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <PrimaryButton label={busy ? 'Working...' : 'Sign in'} icon={ShieldCheck} disabled={busy} onPress={() => submit('login')} />
          <SecondaryButton label="Create account" disabled={busy} onPress={() => submit('register')} />
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

function ProductShell() {
  const theme = useTheme();
  const home = useAppStore((s) => s.home);
  const setHome = useAppStore((s) => s.setHome);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPrefs);
  const [tab, setTab] = useState<TabKey>('brief');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextHome, prefs] = await Promise.all([
        requestApi<MobileHomeSummaryView>('/api/mobile/home'),
        requestApi<NotificationPreferencesView>('/api/notifications/preferences'),
      ]);
      setHome(nextHome);
      setNotificationPrefs(prefs);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert('Could not refresh', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, [setHome, setNotificationPrefs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const content = useMemo(() => {
    if (!home) {
      return (
        <View style={styles.centerGrow}>
          <ActivityIndicator color={theme.accent} />
        </View>
      );
    }
    const hasLinkedItems = home.items.length > 0;
    if (tab === 'brief') {
      return hasLinkedItems ? <BriefScreen home={home} onRefresh={refresh} refreshing={refreshing} /> : <LinkingScreen onLinked={refresh} />;
    }
    if (PREMIUM_TABS.has(tab) && !home.billing.isPremium) {
      return <PaywallScreen billing={home.billing} home={home} source={tab} onChanged={refresh} />;
    }
    if (tab === 'coach') return <CoachScreen />;
    if (tab === 'goals') return <GoalsScreen goals={home.goals} billing={home.billing} onChanged={refresh} />;
    if (tab === 'subs') return <SubscriptionsScreen audit={home.subscriptionAudit} onChanged={refresh} />;
    if (tab === 'wins') return <WinsScreen wins={home.moneyWins} moneyPhysical={home.moneyPhysical} billing={home.billing} anomalies={home.openAnomalies} onChanged={refresh} />;
    return <SettingsScreen items={home.items} billing={home.billing} onChanged={refresh} />;
  }, [home, refresh, refreshing, tab, theme.accent]);

  const isHome = tab === 'brief';

  return (
    <SafeAreaView style={[styles.appScreen, { backgroundColor: theme.bg }]}>
      <StatusBar style="light" />
      <ZenBackdrop />
      <View style={styles.zenFrame}>
        {!isHome ? (
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
        {home && !isHome ? (
          <View style={styles.shellRail}>
            <ShellCoachConsole home={home} onAsk={() => setTab('coach')} />
          </View>
        ) : null}
        <View style={styles.content}>{content}</View>
        {home ? <TabBar active={tab} onChange={setTab} /> : null}
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

function LinkingScreen({ onLinked }: { onLinked: () => void }) {
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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
}: {
  home: MobileHomeSummaryView;
  onRefresh: () => void;
  refreshing: boolean;
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
      refreshControl={undefined}
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
      <ZenGlass style={styles.zenScorePill}>
        <View style={styles.zenScoreIcon}>
          <ZenLotus size={15} />
        </View>
        <Text style={styles.zenScoreText}>Zen Score: 88/100</Text>
        <View style={styles.zenScoreDot} />
      </ZenGlass>
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
        <EmptyMini title="Your first brief is still warming up" copy="Pull to refresh after sync finishes." />
      )}
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
      />
      <ActionRow
        icon={CreditCard}
        title="Subscription audit"
        detail={`${usd(home.subscriptionAudit.cancelCandidateMonthlyCents, true)}/mo can be reviewed now`}
      />
      <ActionRow
        icon={Bell}
        title="Open alerts"
        detail={`${home.openAnomalies.length} charge${home.openAnomalies.length === 1 ? '' : 's'} need a decision`}
      />
      <SectionHeader title="Recent Money Movement" />
      {home.recentTransactions.slice(0, 6).map((txn) => (
        <View key={txn.id} style={[styles.row, { borderColor: theme.border }]}>
          <View>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{txn.merchantClean ?? txn.merchantName ?? txn.name}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{dateLabel(txn.postedDate)} · {txn.category ?? 'uncategorized'}</Text>
          </View>
          <Text style={[styles.amount, { color: txn.amountCents > 0 ? theme.ink : theme.success }]}>{usd(txn.amountCents)}</Text>
        </View>
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
      <View style={styles.zenDailyFocus}>
        <View style={styles.flexShrink}>
          <Text style={styles.zenDailyKicker}>DAILY FOCUS</Text>
          <Text style={styles.zenDailyText}>{brief.action.description}</Text>
          <Text style={styles.zenDailyMeta}>{brief.action.timeframe}</Text>
        </View>
        <Pressable style={styles.zenSwapButton} onPress={() => feedback('up')}>
          <Text style={styles.zenSwapText}>View Move</Text>
        </Pressable>
      </View>
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

function InsightPanel({ insight }: { insight: InsightView }) {
  const theme = useTheme();
  async function feedback(rating: 'up' | 'down') {
    await requestApi(`/api/insights/${insight.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }).catch((err) => Alert.alert('Feedback failed', err instanceof Error ? err.message : 'Unknown error'));
  }
  return (
    <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
    </View>
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
      <View style={[styles.largeIcon, { backgroundColor: theme.accentSoft }]}>
        <Bot color={theme.accent} size={34} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.ink }]}>Ask about your money</Text>
      <Text style={[styles.emptyCopy, { color: theme.muted }]}>
        Start with a question that has a dollar amount, merchant, category, or goal attached.
      </Text>
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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
      </View>

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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="Goals" />
      {goals.map((goal) => (
        <View key={goal.id} style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
        </View>
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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <SubscriptionMetricStrip audit={audit} />
      {audit.items.map((item) => (
        <View key={item.recurringStreamId} style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
        </View>
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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
      </View>
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.panelKicker, { color: theme.accent }]}>Money Wins</Text>
        <Text style={[styles.bigNumber, { color: theme.ink }]}>{usd(wins.verifiedTotalCents + wins.estimatedTotalCents, true)}</Text>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>
          {usd(wins.verifiedTotalCents, true)} verified · {usd(wins.estimatedTotalCents, true)} estimated
        </Text>
      </View>
      {wins.wins.map((win) => (
        <View key={win.id} style={[styles.row, { borderColor: theme.border }]}>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{win.description}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{win.status} · {dateLabel(win.createdAt)}</Text>
          </View>
          <View style={styles.rightStack}>
            <Text style={[styles.amount, { color: win.status === 'verified' ? theme.success : theme.gold }]}>{usd(win.amountCents, true)}</Text>
            {win.status === 'estimated' ? <Pressable onPress={() => confirm(win.id)}><Text style={[styles.linkText, { color: theme.accent }]}>confirm</Text></Pressable> : null}
          </View>
        </View>
      ))}
      <SectionHeader title="Charge Alerts" />
      {anomalies.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: theme.border }]}>
          <View style={styles.flexShrink}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>{item.title}</Text>
            <Text style={[styles.rowDetail, { color: theme.muted }]}>{item.detail}</Text>
          </View>
          <Pressable onPress={() => recover(item.id)}>
            <Text style={[styles.linkText, { color: theme.accent }]}>recovered</Text>
          </Pressable>
        </View>
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
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="Billing" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
      </View>
      <SectionHeader title="Invite Credit" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
      </View>
      <SectionHeader title="Freelancer Mode" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
      </View>
      <SectionHeader title="Household Sharing" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
              <View key={member.id} style={[styles.row, { borderColor: theme.border }]}>
                <View style={[styles.smallIcon, { backgroundColor: theme.accentSoft }]}>
                  <Users color={theme.accent} size={18} />
                </View>
                <View style={styles.flexShrink}>
                  <Text style={[styles.rowTitle, { color: theme.ink }]}>{member.email}</Text>
                  <Text style={[styles.rowDetail, { color: theme.muted }]}>{member.role} · individual privacy zone</Text>
                </View>
              </View>
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
      </View>
      <SectionHeader title="Notifications" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <PrimaryButton label={prefs?.pushEnabled ? 'Push enabled' : 'Enable push notifications'} icon={Bell} onPress={registerPush} />
        {prefs ? (
          <>
            <Toggle label="Weekly brief" value={prefs.weeklyBrief} onValueChange={(v) => updatePrefs({ ...prefs, weeklyBrief: v })} />
            <Toggle label="Charge alerts" value={prefs.anomalies} onValueChange={(v) => updatePrefs({ ...prefs, anomalies: v })} />
            <Toggle label="Goal pacing" value={prefs.goalPacing} onValueChange={(v) => updatePrefs({ ...prefs, goalPacing: v })} />
          </>
        ) : null}
      </View>
      <SectionHeader title="Linked Banks" />
      {items.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: theme.border }]}>
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
        </View>
      ))}
      <SectionHeader title="Data Rights" />
      <SecondaryButton label="Export my data" icon={ShieldCheck} onPress={exportData} />
      <SectionHeader title="App Update" />
      <View style={[styles.primaryPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.updateMeta, { color: theme.muted }]}>{updateMeta}</Text>
        <SecondaryButton
          label={updateBusy ? 'Checking...' : 'Check for update'}
          icon={RefreshCcw}
          disabled={updateBusy}
          onPress={checkForUpdate}
        />
      </View>
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

function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const theme = useTheme();
  const tabs: Array<{ key: TabKey; icon: typeof Sparkles; label: string }> = [
    { key: 'brief', icon: Sparkles, label: 'Brief' },
    { key: 'coach', icon: MessageCircle, label: 'Coach' },
    { key: 'goals', icon: Target, label: 'Goals' },
    { key: 'subs', icon: WalletCards, label: 'Audit' },
    { key: 'wins', icon: PiggyBank, label: 'Wins' },
    { key: 'settings', icon: Moon, label: 'More' },
  ];
  return (
    <View style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            style={[
              styles.tabItem,
              selected ? [styles.tabItemActive, { backgroundColor: theme.accentSoft, borderColor: theme.accent }] : null,
            ]}
            onPress={() => onChange(tab.key)}
          >
            <Icon color={selected ? theme.accent : theme.muted} size={selected ? 22 : 20} />
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
    <View style={[styles.coachCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
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
  const theme = useTheme();
  return (
    <View style={[styles.sectionBand, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
  );
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

function ActionRow({ icon: Icon, title, detail }: { icon: IconComponent; title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={[styles.smallIcon, { backgroundColor: theme.accentSoft }]}>
        <Icon color={theme.accent} size={18} />
      </View>
      <View style={styles.flexShrink}>
        <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>{detail}</Text>
      </View>
      <ChevronRight color={theme.muted} size={18} />
    </View>
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
  const contentColor = disabled ? theme.muted : '#fff';
  return (
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
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerGrow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authScreen: { flex: 1 },
  authContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  authContentV2: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, gap: 14 },
  authBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  authLogo: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF1A', backgroundColor: '#FFFFFF0D' },
  authBrandText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  appScreen: { flex: 1 },
  content: { flex: 1 },
  zenBackdrop: StyleSheet.absoluteFill,
  zenFrame: { flex: 1, marginHorizontal: 12, marginTop: 8, marginBottom: 8, borderRadius: 28, borderWidth: 1, borderColor: '#FFFFFF26', overflow: 'hidden' },
  zenHomeScroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 24, gap: 14 },
  zenHomeHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  zenLotusMark: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  zenBrand: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  zenHeaderAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  zenScorePill: { alignSelf: 'center', minHeight: 34, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  zenScoreIcon: { width: 22, height: 22, borderRadius: 7, backgroundColor: '#FFFFFF33', alignItems: 'center', justifyContent: 'center' },
  zenScoreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  zenScoreDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#79E6B0' },
  zenGlass: { backgroundColor: '#FFFFFF14', borderWidth: 1, borderRadius: 24, padding: 16, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  zenInsightCard: { gap: 12, borderColor: '#FFFFFF38' },
  zenInsightHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zenInsightIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: '#00D2D326', alignItems: 'center', justifyContent: 'center' },
  zenInsightKicker: { color: '#00D2D3', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  zenImpact: { color: '#FFFFFFB3', fontSize: 11, fontWeight: '800' },
  zenInsightTitle: { color: '#FFFFFF', fontSize: 27, lineHeight: 31, fontWeight: '300' },
  zenInsightBody: { color: '#FFFFFFB3', fontSize: 13, lineHeight: 18 },
  zenDailyFocus: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#00D2D314', borderWidth: 1, borderColor: '#00D2D34D' },
  zenDailyKicker: { color: '#00D2D3', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  zenDailyText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 4 },
  zenDailyMeta: { color: '#FFFFFF99', fontSize: 11, lineHeight: 16, marginTop: 4 },
  zenSwapButton: { minHeight: 32, borderRadius: 16, paddingHorizontal: 11, justifyContent: 'center', backgroundColor: '#FFFFFFB3' },
  zenSwapText: { color: '#0B0E14', fontSize: 10, fontWeight: '900' },
  zenInsightFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zenEvidence: { flex: 1, color: '#FFFFFF80', fontSize: 10 },
  zenVoiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  zenStatCard: { flex: 1, minHeight: 82, padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF1A', gap: 2 },
  zenStatLabel: { color: '#FFFFFFB3', fontSize: 10, fontWeight: '700' },
  zenStatValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  zenStatMeta: { color: '#FFFFFF80', fontSize: 10 },
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
  appTitle: { fontSize: 24, fontWeight: '800' },
  appSub: { fontSize: 13, marginTop: 2 },
  iconButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF1A' },
  shellRail: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#0B0E14B3', borderBottomWidth: 1, borderBottomColor: '#FFFFFF1A' },
  coachConsole: { borderWidth: 1, borderRadius: 24, padding: 12, gap: 10, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  consoleHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  consoleStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  consoleChip: { minHeight: 30, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  consoleChipText: { fontSize: 12, fontWeight: '800' },
  consoleDot: { width: 7, height: 7, borderRadius: 4 },
  consoleAskPill: { minHeight: 42, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, shadowColor: '#05a77b', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  consoleAskText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  consoleNextAction: { minHeight: 70, borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  consoleActionKicker: { fontSize: 11, lineHeight: 15, fontWeight: '900', textTransform: 'uppercase' },
  consoleActionText: { fontSize: 14, lineHeight: 20, fontWeight: '900' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, fontSize: 15 },
  primaryButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, shadowColor: '#00D2D3', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  primaryButtonText: { flexShrink: 1, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  secondaryButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  compactButton: { minHeight: 38, flex: 1 },
  secondaryButtonText: { flexShrink: 1, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  largeIcon: { width: 72, height: 72, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  emptyCopy: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  statusRail: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, minHeight: 82, borderWidth: 1, borderRadius: 8, padding: 12, gap: 4 },
  metricValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 12, fontWeight: '700' },
  primaryPanel: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 12, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  sectionBand: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 12, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelKicker: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  panelTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  panelBody: { fontSize: 15, lineHeight: 22 },
  briefHeroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  impactPill: { minWidth: 82, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  impactValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  impactLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceChip: { maxWidth: '100%', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  evidenceText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  voiceInline: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  actionBox: { borderRadius: 16, padding: 14, gap: 4, borderWidth: 1, borderColor: '#00D2D34D' },
  actionTitle: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  actionMeta: { fontSize: 13, lineHeight: 18 },
  inlineButtons: { flexDirection: 'row', gap: 10 },
  featureList: { gap: 9 },
  featureLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  planOption: { minHeight: 68, borderWidth: 1, borderRadius: 8, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#6c7b84', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  planBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 10 },
  row: { minHeight: 64, borderBottomWidth: 1, paddingVertical: 12, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 12 },
  destructiveIconButton: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowDetail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  updateMeta: { fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  smallIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabBar: { marginHorizontal: 12, marginBottom: Platform.OS === 'ios' ? 12 : 8, borderWidth: 1, borderRadius: 22, flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 7, shadowColor: '#000', shadowOpacity: 0.37, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10, backgroundColor: '#FFFFFF14' },
  tabItem: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 0, borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  tabItemActive: { shadowColor: '#00D2D3', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  tabText: { fontSize: 11, fontWeight: '800' },
  chatList: { flexGrow: 1, padding: 20, gap: 10 },
  coachCard: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 8, marginBottom: 10, shadowColor: '#6c7b84', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
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

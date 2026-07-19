import { BlurView } from 'expo-blur';
import { CreditCard, LockKeyhole, MessageCircle, SlidersHorizontal, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BillingStatusView, MobileHomeSummaryView, PaywallPackageView } from '@zenfinance/shared';
import { styles } from '../styles';

const theme = {
  ink: '#FFFFFF',
  muted: '#FFFFFF99',
  border: '#FFFFFF26',
  surface: '#FFFFFF0D',
  accent: '#00D2D3',
  accentBright: '#48EFEF',
  accentSoft: '#00D2D326',
  violet: '#8E44AD',
  violetSoft: '#8E44AD26',
  gold: '#F5D58A',
  goldSoft: '#F5D58A26',
};

type StorePackageView = {
  product: {
    identifier: string;
    priceString: string;
  };
};

type PaywallViewProps = {
  billing: BillingStatusView;
  home?: MobileHomeSummaryView;
  storePackages: StorePackageView[];
  selectedProductId?: string;
  busy: string | null;
  storeMessage: string | null;
  brandMark: ReactNode;
  purchaseButton: ReactNode;
  onSelect: (productId: string) => void;
  onRestore: () => void;
  onDismiss?: () => void;
};

function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function Glass({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[styles.zenGlass, { borderColor: theme.border }, style]}>
      <BlurView intensity={28} tint="dark" style={styles.zenGlassBlur as never} />
      <View pointerEvents="none" style={styles.zenGlassTint} />
      {children}
    </View>
  );
}

function Benefit({ icon: Icon, title, detail, tone }: { icon: LucideIcon; title: string; detail: string; tone: 'teal' | 'violet' | 'gold' }) {
  const colors = tone === 'violet'
    ? { color: theme.violet, bg: theme.violetSoft }
    : tone === 'gold'
      ? { color: theme.gold, bg: theme.goldSoft }
      : { color: theme.accentBright, bg: theme.accentSoft };
  return (
    <View style={styles.paywallBenefit}>
      <View style={[styles.paywallBenefitIcon, { backgroundColor: colors.bg }]}><Icon color={colors.color} size={16} /></View>
      <View style={styles.flexShrink}>
        <Text style={styles.paywallBenefitTitle}>{title}</Text>
        <Text style={styles.paywallBenefitDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function PlanOption({ pkg, selected, price, onPress }: { pkg: PaywallPackageView; selected: boolean; price: string; onPress: () => void }) {
  const featured = pkg.identifier === 'annual' && Boolean(pkg.savingsLabel);
  const title = pkg.identifier === 'annual' ? 'Annual' : 'Monthly';
  const detail = pkg.identifier === 'annual'
    ? `$5.00/mo · ${pkg.introTrialDays} days free, then renews`
    : `${pkg.introTrialDays} days free, then renews · Cancel anytime`;
  return (
    <Pressable
      style={[
        styles.planOption,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.accentSoft : featured ? theme.goldSoft : theme.surface,
          shadowColor: selected ? theme.accent : '#000000',
          shadowOpacity: selected ? 0.32 : 0.16,
          shadowRadius: selected ? 20 : 14,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${price}`}
      accessibilityState={{ selected }}
    >
      <View style={styles.flexShrink}>
        <View style={styles.planTitleRow}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
          {featured ? (
            <View style={[styles.planBadge, { backgroundColor: theme.gold }]}>
              <Text style={styles.planBadgeText}>{pkg.savingsLabel ?? 'Best value'}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowDetail, { color: theme.muted }]}>{detail}</Text>
      </View>
      <Text style={[styles.amount, { color: selected ? theme.accent : theme.ink }]}>{price}</Text>
    </Pressable>
  );
}

export function PaywallView({
  billing,
  home,
  storePackages,
  selectedProductId,
  busy,
  storeMessage,
  brandMark,
  purchaseButton,
  onSelect,
  onRestore,
  onDismiss,
}: PaywallViewProps) {
  const packages = [...billing.packages].sort((a, b) => (a.identifier === 'annual' ? -1 : b.identifier === 'annual' ? 1 : 0));
  const totalWins = home ? home.moneyWins.verifiedTotalCents + home.moneyWins.estimatedTotalCents : 0;
  const livePrice = (pkg: PaywallPackageView) => storePackages.find((item) => item.product.identifier === pkg.productId)?.product.priceString ?? pkg.priceLabel;

  return (
    <ScrollView contentContainerStyle={styles.paywallScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.paywallTopRow}>
        {onDismiss ? (
          <Pressable style={styles.paywallClose} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Continue with free plan">
            <X color={theme.muted} size={19} />
          </Pressable>
        ) : <View style={styles.paywallCloseSpacer} />}
        <View style={styles.paywallBrand}>{brandMark}<Text style={styles.paywallBrandText}>Zen-Finance</Text></View>
        <View style={styles.paywallCloseSpacer} />
      </View>

      <View style={styles.paywallHeroCopy}>
        <View style={styles.paywallTrialBadge}><Sparkles color={theme.accentBright} size={13} /><Text style={styles.paywallTrialBadgeText}>3 DAYS FREE</Text></View>
        <Text style={styles.paywallHeadline}>Make your next money move with confidence.</Text>
        <Text style={styles.paywallSubhead}>Try every Zen-Finance tool free for 3 days. Keep the free plan if premium is not for you.</Text>
      </View>

      <Glass style={styles.paywallBenefitsCard}>
        <View style={styles.paywallBenefitsGrid}>
          <Benefit icon={Sparkles} title="One clear move" detail="From real transactions" tone="teal" />
          <Benefit icon={CreditCard} title="Charge audit" detail="Subs and anomalies" tone="violet" />
          <Benefit icon={SlidersHorizontal} title="What-if forecasts" detail="Before goals slip" tone="gold" />
          <Benefit icon={MessageCircle} title="Grounded coach" detail="Answers scoped to you" tone="teal" />
        </View>
        {totalWins > 0 ? <Text style={styles.paywallProof}>Zen-Finance has already surfaced {usd(totalWins)} in Money Wins.</Text> : null}
      </Glass>

      {packages.map((pkg) => (
        <PlanOption key={pkg.productId} pkg={pkg} selected={selectedProductId === pkg.productId} price={livePrice(pkg)} onPress={() => onSelect(pkg.productId)} />
      ))}

      {storeMessage ? <Text style={[styles.actionMeta, { color: theme.gold }]}>{storeMessage}</Text> : null}
      {purchaseButton}
      {onDismiss ? (
        <Pressable style={styles.paywallFreeLink} onPress={onDismiss} accessibilityRole="button">
          <Text style={styles.paywallFreeLinkText}>Continue with free plan</Text>
        </Pressable>
      ) : null}
      <View style={styles.paywallFooterLinks}>
        <Pressable disabled={busy !== null} onPress={onRestore} accessibilityRole="button"><Text style={styles.paywallFooterLink}>{busy === 'restore' ? 'Restoring...' : 'Restore purchases'}</Text></Pressable>
        <View style={styles.paywallFooterDot} />
        <View style={styles.paywallFooterLinks}><LockKeyhole color={theme.muted} size={9} /><Text style={styles.paywallFooterLink}>Secure App Store payment</Text></View>
      </View>
      <Text style={[styles.disclosure, styles.paywallDisclosure, { color: theme.muted }]}>
        Your subscription renews at the selected price after the 3-day trial unless canceled at least 24 hours before the trial ends. Manage or cancel in App Store settings.
      </Text>
    </ScrollView>
  );
}

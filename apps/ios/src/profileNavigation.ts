export type SettingsSection =
  | 'account'
  | 'banks'
  | 'notifications'
  | 'referral'
  | 'freelancer'
  | 'household'
  | 'privacy'
  | 'about';

export type ProfileDestination =
  | { kind: 'tab'; tab: 'budget' | 'score' }
  | { kind: 'settings'; section: SettingsSection };

export interface ProfileMenuItem {
  key: string;
  label: string;
  detail: string;
  icon: string;
  destination: ProfileDestination;
}

export interface ProfileMenuGroup {
  title: string;
  items: ProfileMenuItem[];
}

export const PROFILE_MENU_GROUPS: ProfileMenuGroup[] = [
  {
    title: 'Your money',
    items: [
      {
        key: 'budget',
        label: 'Smart Budgeting',
        detail: 'Spending plan and category targets',
        icon: 'account_balance_wallet',
        destination: { kind: 'tab', tab: 'budget' },
      },
      {
        key: 'banks',
        label: 'Linked banks',
        detail: 'Connect, review, or disconnect accounts',
        icon: 'account_balance',
        destination: { kind: 'settings', section: 'banks' },
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        key: 'account',
        label: 'Account & plan',
        detail: 'Sign-in details, access, and billing',
        icon: 'account_circle',
        destination: { kind: 'settings', section: 'account' },
      },
      {
        key: 'referral',
        label: 'Invite credit',
        detail: 'Share or redeem a referral code',
        icon: 'celebration',
        destination: { kind: 'settings', section: 'referral' },
      },
    ],
  },
  {
    title: 'Preferences',
    items: [
      {
        key: 'notifications',
        label: 'Notifications',
        detail: 'Briefs, alerts, goals, and updates',
        icon: 'notifications',
        destination: { kind: 'settings', section: 'notifications' },
      },
      {
        key: 'freelancer',
        label: 'Freelancer Mode',
        detail: 'Income targets, taxes, and runway',
        icon: 'trending_up',
        destination: { kind: 'settings', section: 'freelancer' },
      },
      {
        key: 'household',
        label: 'Household sharing',
        detail: 'Members and shared goals',
        icon: 'home',
        destination: { kind: 'settings', section: 'household' },
      },
    ],
  },
  {
    title: 'Privacy & help',
    items: [
      {
        key: 'privacy',
        label: 'Security & privacy',
        detail: 'Data rights and account controls',
        icon: 'shield',
        destination: { kind: 'settings', section: 'privacy' },
      },
      {
        key: 'about',
        label: 'Help & app info',
        detail: 'Support, legal, and app updates',
        icon: 'info',
        destination: { kind: 'settings', section: 'about' },
      },
    ],
  },
];

export const SETTINGS_SECTION_COPY: Record<SettingsSection, { title: string; subtitle: string }> = {
  account: { title: 'Account & plan', subtitle: 'Your identity, access, and membership' },
  banks: { title: 'Linked banks', subtitle: 'Manage the accounts ZenFinance can read' },
  notifications: { title: 'Notifications', subtitle: 'Choose the money signals worth interrupting you' },
  referral: { title: 'Invite credit', subtitle: 'Share ZenFinance or redeem an invite' },
  freelancer: { title: 'Freelancer Mode', subtitle: 'Tune income, taxes, and runway' },
  household: { title: 'Household sharing', subtitle: 'Share goals without sharing private finances' },
  privacy: { title: 'Security & privacy', subtitle: 'Control your data and account' },
  about: { title: 'Help & app info', subtitle: 'Support, legal, and update details' },
};

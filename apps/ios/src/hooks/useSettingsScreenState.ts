import type { FreelancerSummaryView, HouseholdStatusView, ReferralStatusView } from '@zenfinance/shared';
import { useReducerState } from './useReducerState';

export function useSettingsScreenState() {
  const [billingBusy, setBillingBusy] = useReducerState(false);
  const [referral, setReferral] = useReducerState<ReferralStatusView | null>(null);
  const [redeemCode, setRedeemCode] = useReducerState('');
  const [referralBusy, setReferralBusy] = useReducerState(false);
  const [freelancer, setFreelancer] = useReducerState<FreelancerSummaryView | null>(null);
  const [freelancerBusy, setFreelancerBusy] = useReducerState(false);
  const [targetIncome, setTargetIncome] = useReducerState('');
  const [taxSetAside, setTaxSetAside] = useReducerState('25');
  const [runwayTarget, setRunwayTarget] = useReducerState('3');
  const [household, setHousehold] = useReducerState<HouseholdStatusView | null>(null);
  const [householdBusy, setHouseholdBusy] = useReducerState(false);
  const [householdInviteEmail, setHouseholdInviteEmail] = useReducerState('');
  const [householdInviteCode, setHouseholdInviteCode] = useReducerState('');
  const [sharedGoalName, setSharedGoalName] = useReducerState('');
  const [sharedGoalTarget, setSharedGoalTarget] = useReducerState('');
  const [householdContribution, setHouseholdContribution] = useReducerState<Record<number, string>>({});
  const [updateBusy, setUpdateBusy] = useReducerState(false);

  return {
    billingBusy, setBillingBusy, referral, setReferral, redeemCode, setRedeemCode,
    referralBusy, setReferralBusy, freelancer, setFreelancer, freelancerBusy, setFreelancerBusy,
    targetIncome, setTargetIncome, taxSetAside, setTaxSetAside, runwayTarget, setRunwayTarget,
    household, setHousehold, householdBusy, setHouseholdBusy, householdInviteEmail, setHouseholdInviteEmail,
    householdInviteCode, setHouseholdInviteCode, sharedGoalName, setSharedGoalName,
    sharedGoalTarget, setSharedGoalTarget, householdContribution, setHouseholdContribution,
    updateBusy, setUpdateBusy,
  };
}

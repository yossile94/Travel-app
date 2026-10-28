/**
 * Everything of the travel kit on this device (sprint 8 AC-9, AC-10): the
 * memory, the policy files and their key, and the scheduled reminders. Run
 * with the trips copy on sign-out, account deletion and wipeDevice; the
 * encrypted kit copy itself goes with clearTripsCaches (same prefix).
 */
import { cancelAllInsuranceReminders } from './insuranceReminder';
import { resetKitStore } from './kitStore';
import { wipePolicies } from './policyFile';

export async function wipeKitDevice(): Promise<void> {
  resetKitStore();
  await Promise.all([wipePolicies(), cancelAllInsuranceReminders()]);
}

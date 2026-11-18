// frontend/src/pages/profile/JoinUnit.jsx
// /my/unit — a super admin's unit membership on its own page (sidebar: Visits → Join a unit).
import { PageHeader } from '../../components/ui';
import UnitMembershipPanel from '../../components/UnitMembershipPanel';

export default function JoinUnit() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="Unit membership" meta="Work as an employee and host visits" />
      <div className="max-w-[760px]">
        <UnitMembershipPanel showTitle={false} />
      </div>
    </div>
  );
}

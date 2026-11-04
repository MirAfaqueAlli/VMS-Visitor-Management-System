// frontend/src/pages/gate/GatePass.jsx
// Gate pass page for staff: the pass (components/gate/GatePassCard) with Back / Print.
import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Printer } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { PageHeader, Spinner } from "../../components/ui";
import GatePassCard from "../../components/gate/GatePassCard";

export default function GatePass() {
  const { passNumber } = useParams();
  const navigate = useNavigate();
  // ?unit_id= when the pass belongs to another unit (an employee hosted there)
  const [searchParams] = useSearchParams();
  const unitId = searchParams.get("unit_id");
  const [passData, setPassData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPass = async () => {
      try {
        const response = await apiClient.get(`/passes/pass/${passNumber}`, { params: unitId ? { unit_id: unitId } : undefined });
        setPassData(response.data.data);
      } catch {
        toast.error("Failed to load gate pass");
        navigate("/dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchPass();
  }, [passNumber, unitId, navigate]);

  if (loading) return <><PageHeader title="Gate pass" /><Spinner label="Loading the pass…" /></>;
  if (!passData) return null;

  return (
    <div className="animate-fade-in">
      <div className="print:hidden">
        <PageHeader
          title="Gate pass"
          meta={<span className="mono">{passData.pass_number}</span>}
          actions={(
            <>
              <button type="button" onClick={() => navigate(-1)} className="btn-outline">Back</button>
              <button type="button" onClick={() => window.print()} className="btn-primary">
                <Printer size={14} /> Print pass
              </button>
            </>
          )}
        />
      </div>

      <GatePassCard pass={{ ...passData, qr: passData.qr_code_path }} />
    </div>
  );
}

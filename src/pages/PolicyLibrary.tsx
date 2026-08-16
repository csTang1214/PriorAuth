import { useEffect, useState } from "react";
import { listPolicyDocuments } from "../policy";

interface DocRow {
  id: number;
  payer: string;
  specialty: string;
  title: string;
  source_url: string;
  effective_date: string | null;
  fetched_at: string;
}

export default function PolicyLibrary() {
  const [docs, setDocs] = useState<DocRow[] | null>(null);

  useEffect(() => {
    listPolicyDocuments().then(setDocs);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Policy Library</h1>
      </div>

      <p className="hint">
        Local corpus of payer medical-necessity criteria (spec §4.2). Phase 2 seeded this with
        one real entry (Aetna / Physical Therapy, ingested via{" "}
        <code>scripts/ingest-policy-aetna-pt.mjs</code>); Phase 6 expands coverage payer by
        payer.
      </p>

      {docs === null && <p>Loading…</p>}
      {docs !== null && docs.length === 0 && (
        <p className="empty-state">No policy documents ingested yet.</p>
      )}

      {docs !== null && docs.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Specialty</th>
              <th>Title</th>
              <th>Effective</th>
              <th>Fetched</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.payer}</td>
                <td>{d.specialty}</td>
                <td>
                  <a href={d.source_url} target="_blank" rel="noreferrer">
                    {d.title}
                  </a>
                </td>
                <td>{d.effective_date ?? "—"}</td>
                <td>{new Date(d.fetched_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

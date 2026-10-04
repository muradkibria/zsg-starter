// Add a rider / edit a rider's details, in a sheet.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { RIDER_STAGE_LABEL, type RiderDetail, type RiderSettableStage } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { useCreateRider, useUpdateRider } from "./api";
import { RadioCard, Sheet } from "./bits";

const SETTABLE: { value: RiderSettableStage; hint: string }[] = [
  { value: "applied", hint: "Documents still to collect or check" },
  { value: "checked", hint: "Documents checked, not ready for a bag yet" },
  { value: "waiting", hint: "Ready to go out as soon as there's a bag" },
];

const emailOk = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function StageChoice({ value, onChange }: { value: RiderSettableStage; onChange: (v: RiderSettableStage) => void }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[13px] font-semibold">Stage</legend>
      {SETTABLE.map((s) => (
        <RadioCard key={s.value} name="rider-stage" checked={value === s.value} onChange={() => onChange(s.value)}>
          <span className="block text-sm font-semibold">{RIDER_STAGE_LABEL[s.value]}</span>
          <span className="block text-xs text-muted">{s.hint}</span>
        </RadioCard>
      ))}
    </fieldset>
  );
}

export function AddRiderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<RiderSettableStage>("applied");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const create = useCreateRider();
  const { toast } = useFeedback();
  const nav = useNavigate();

  const nameError = tried && !name.trim() ? "Add the rider's name" : null;
  const emailError = tried && !emailOk(email.trim()) ? "That email address doesn't look right" : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim() || !emailOk(email.trim())) return;
    create.mutate(
      { name: name.trim(), phone: phone.trim(), email: email.trim(), stage, notes: notes.trim() },
      {
        onSuccess: (r) => {
          toast(`Added ${r.name}. Upload their documents next.`);
          onClose();
          nav(`/riders/${r.id}`);
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a rider"
      sub="A contractor who'll carry a bag. You can upload their documents next."
      footer={
        <div className="flex gap-2">
          <Button onClick={onClose} className="flex-1 md:flex-none">
            Cancel
          </Button>
          <Button type="submit" form="add-rider" variant="primary" loading={create.isPending} className="flex-1">
            Add rider
          </Button>
        </div>
      }
    >
      <form id="add-rider" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Name" error={nameError}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} autoFocus />
        </Field>
        <Field label="Phone" hint="Optional">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="off" maxLength={40} />
        </Field>
        <Field label="Email" hint="Optional" error={emailError}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" maxLength={200} />
        </Field>
        <StageChoice value={stage} onChange={setStage} />
        <Field label="Notes" hint="Optional. Keep personal details out — documents go in Documents.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} />
        </Field>
      </form>
    </Sheet>
  );
}

export function EditRiderSheet({ rider, open, onClose }: { rider: RiderDetail; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(rider.name);
  const [phone, setPhone] = useState(rider.phone);
  const [email, setEmail] = useState(rider.email);
  const settable = rider.stage === "applied" || rider.stage === "checked" || rider.stage === "waiting";
  const [stage, setStage] = useState<RiderSettableStage>(settable ? (rider.stage as RiderSettableStage) : "waiting");
  const [tried, setTried] = useState(false);
  const update = useUpdateRider(rider.id);
  const { toast } = useFeedback();

  const nameError = tried && !name.trim() ? "The name can't be empty" : null;
  const emailError = tried && !emailOk(email.trim()) ? "That email address doesn't look right" : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim() || !emailOk(email.trim())) return;
    update.mutate(
      { name: name.trim(), phone: phone.trim(), email: email.trim(), ...(settable ? { stage } : {}) },
      {
        onSuccess: () => {
          toast("Saved");
          onClose();
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Edit ${rider.name}`}
      footer={
        <div className="flex gap-2">
          <Button onClick={onClose} className="flex-1 md:flex-none">
            Cancel
          </Button>
          <Button type="submit" form="edit-rider" variant="primary" loading={update.isPending} className="flex-1">
            Save
          </Button>
        </div>
      }
    >
      <form id="edit-rider" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Name" error={nameError}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="off" maxLength={40} />
        </Field>
        <Field label="Email" error={emailError}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" maxLength={200} />
        </Field>
        {settable ? (
          <StageChoice value={stage} onChange={setStage} />
        ) : (
          <p className="m-0 text-[13px] text-muted">
            {rider.stage === "active"
              ? "The stage follows their bag: end the assignment to change it."
              : "They've ended. Use “Bring back” on their page to start again."}
          </p>
        )}
      </form>
    </Sheet>
  );
}

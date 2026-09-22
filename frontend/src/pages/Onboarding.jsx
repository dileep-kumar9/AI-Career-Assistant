import { useState } from "react";
import { useUser } from "../context/UserContext";
import { Card, Button, Input, ErrorBanner } from "../components/UI";

export default function Onboarding() {
  const { createAndSetUser } = useUser();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await createAndSetUser(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card title="Welcome — create your profile to get started">
        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Full name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <ErrorBanner message={error} />
          <Button type="submit" loading={loading} className="w-full">
            Get started
          </Button>
        </form>
      </Card>
    </div>
  );
}

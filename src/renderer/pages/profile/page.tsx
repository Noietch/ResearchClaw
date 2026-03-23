import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Sparkles, UserRound } from 'lucide-react';
import type { UserProfile } from '@shared';
import { ipc, type UserProfileState } from '../../hooks/use-ipc';
import { useToast } from '../../components/toast';

const EMPTY_PROFILE: UserProfile = {
  name: '',
  title: '',
  organization: '',
  bio: '',
  researchInterests: '',
  goals: '',
  aiSummary: null,
  aiSummaryUpdatedAt: null,
};

export function ProfilePage() {
  const toast = useToast();
  const [state, setState] = useState<UserProfileState | null>(null);
  const [draft, setDraft] = useState<UserProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipc.getUserProfile();
      setState(data);
      setDraft(data.profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to load profile: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleChange = useCallback((field: keyof UserProfile, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const data = await ipc.updateUserProfile({
        name: draft.name,
        title: draft.title,
        organization: draft.organization,
        bio: draft.bio,
        researchInterests: draft.researchInterests,
        goals: draft.goals,
      });
      setState(data);
      setDraft(data.profile);
      toast.success('Profile saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save profile: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [draft, toast]);

  const handleGenerateSummary = useCallback(async () => {
    setSummarizing(true);
    try {
      const data = await ipc.generateUserProfileSummary();
      setState(data);
      setDraft(data.profile);
      toast.success('Profile summary updated from your Library');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to generate profile summary: ${message}`);
    } finally {
      setSummarizing(false);
    }
  }, [toast]);

  const summaryUpdatedLabel = useMemo(() => {
    const value = state?.profile.aiSummaryUpdatedAt;
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [state?.profile.aiSummaryUpdatedAt]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-notion-text-secondary">
        <Loader2 size={20} className="mr-2 animate-spin" /> Loading profile...
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="rounded-xl border border-notion-border bg-white p-6 shadow-notion">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <UserRound size={20} className="text-blue-600" />
              <h1 className="text-2xl font-semibold text-notion-text">Profile</h1>
            </div>
            <p className="text-sm text-notion-text-secondary">
              Edit your researcher profile and let the app summarize your Library into a living
              profile.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGenerateSummary}
              disabled={summarizing}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {summarizing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Summarize from Library
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text transition-colors hover:bg-notion-sidebar disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save profile
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-notion-border bg-white p-6 shadow-notion">
          <div className="grid gap-4 md:grid-cols-2">
            <ProfileField
              label="Name"
              value={draft.name}
              onChange={(value) => handleChange('name', value)}
            />
            <ProfileField
              label="Title"
              value={draft.title ?? ''}
              onChange={(value) => handleChange('title', value)}
            />
            <ProfileField
              label="Organization"
              value={draft.organization ?? ''}
              onChange={(value) => handleChange('organization', value)}
            />
            <div className="md:col-span-2">
              <ProfileTextarea
                label="Research Interests"
                value={draft.researchInterests ?? ''}
                onChange={(value) => handleChange('researchInterests', value)}
                placeholder="e.g. multimodal retrieval, LLM agents, citation graphs"
              />
            </div>
            <div className="md:col-span-2">
              <ProfileTextarea
                label="Current Goals"
                value={draft.goals ?? ''}
                onChange={(value) => handleChange('goals', value)}
                placeholder="What are you trying to learn, build, or publish next?"
              />
            </div>
            <div className="md:col-span-2">
              <ProfileTextarea
                label="Bio"
                value={draft.bio ?? ''}
                onChange={(value) => handleChange('bio', value)}
                placeholder="A short self-description of your background and focus."
                rows={5}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-notion-border bg-white p-6 shadow-notion">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-notion-text-tertiary">
              Library Snapshot
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <SnapshotCard
                label="Papers"
                value={String(state?.librarySnapshot.totalPapers ?? 0)}
              />
              <SnapshotCard
                label="Top Tags"
                value={
                  state?.librarySnapshot.topTags
                    .map((tag) => tag.name)
                    .slice(0, 3)
                    .join(', ') || '—'
                }
              />
              <SnapshotCard
                label="Top Authors"
                value={
                  state?.librarySnapshot.topAuthors
                    .map((author) => author.name)
                    .slice(0, 3)
                    .join(', ') || '—'
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-notion-border bg-white p-6 shadow-notion">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-notion-text">AI Summary</h2>
                <p className="mt-1 text-sm text-notion-text-secondary">
                  Generated from your editable profile and current Library patterns.
                </p>
              </div>
              {summaryUpdatedLabel && (
                <span className="text-xs text-notion-text-tertiary">
                  Updated {summaryUpdatedLabel}
                </span>
              )}
            </div>
            <div className="mt-4 rounded-lg border border-notion-border bg-notion-sidebar/40 p-4 text-sm leading-7 text-notion-text-secondary whitespace-pre-wrap">
              {state?.profile.aiSummary ||
                'No AI profile summary yet. Save your profile and click “Summarize from Library”.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-notion-text">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text outline-none transition-colors focus:border-blue-300 focus:bg-white"
      />
    </label>
  );
}

function ProfileTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-notion-text">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-notion-border bg-white px-3 py-2 text-sm leading-6 text-notion-text outline-none transition-colors focus:border-blue-300 focus:bg-white"
      />
    </label>
  );
}

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-notion-border bg-white p-4 hover:bg-blue-50 hover:border-blue-200 transition-colors duration-150">
      <div className="text-xs font-medium uppercase tracking-wide text-notion-text-tertiary">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-notion-text">{value}</div>
    </div>
  );
}

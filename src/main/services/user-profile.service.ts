import { PapersRepository } from '@db';
import type { UserProfile, UserProfileLibrarySnapshot, UserProfileState } from '@shared';
import { generateWithActiveProvider } from './ai-provider.service';
import { getUserProfile, setUserProfile } from '../store/app-settings-store';

const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  title: '',
  organization: '',
  bio: '',
  researchInterests: '',
  goals: '',
  aiSummary: null,
  aiSummaryUpdatedAt: null,
};

export class UserProfileService {
  private papersRepository = new PapersRepository();

  async getProfile(): Promise<UserProfileState> {
    return {
      profile: this.normalizeProfile(getUserProfile()),
      librarySnapshot: await this.buildLibrarySnapshot(),
    };
  }

  async updateProfile(input: Partial<UserProfile>): Promise<UserProfileState> {
    const current = this.normalizeProfile(getUserProfile());
    const next: UserProfile = {
      ...current,
      name: input.name ?? current.name,
      title: input.title ?? current.title,
      organization: input.organization ?? current.organization,
      bio: input.bio ?? current.bio,
      researchInterests: input.researchInterests ?? current.researchInterests,
      goals: input.goals ?? current.goals,
      aiSummary: current.aiSummary ?? null,
      aiSummaryUpdatedAt: current.aiSummaryUpdatedAt ?? null,
    };
    setUserProfile(next);
    return {
      profile: next,
      librarySnapshot: await this.buildLibrarySnapshot(),
    };
  }

  async generateSummary(): Promise<UserProfileState> {
    const profile = this.normalizeProfile(getUserProfile());
    const { snapshot, promptContext } = await this.buildSummaryContext();

    if (snapshot.totalPapers === 0) {
      throw new Error('Add papers to your Library before generating a profile summary.');
    }

    const summary = await generateWithActiveProvider(
      [
        'You are writing a concise, practical research profile for a user.',
        "Use the provided library evidence first, then incorporate the user's self-description.",
        'Return 2 short paragraphs followed by 3-5 bullet points.',
        'Focus on research themes, methods, and likely interests. Avoid hype.',
      ].join(' '),
      [
        'Create a researcher profile summary based on this information:',
        '',
        '## User profile fields',
        promptContext,
        '',
        '## Output requirements',
        "- Mention the user's main research directions.",
        '- Mention method preferences or recurring technical patterns when supported.',
        '- Mention what they appear to be exploring next.',
        '- Keep the tone professional and useful.',
      ].join('\n'),
    );

    const nextProfile: UserProfile = {
      ...profile,
      aiSummary: summary.trim(),
      aiSummaryUpdatedAt: new Date().toISOString(),
    };
    setUserProfile(nextProfile);

    return {
      profile: nextProfile,
      librarySnapshot: snapshot,
    };
  }

  private normalizeProfile(profile?: Partial<UserProfile> | null): UserProfile {
    return {
      ...DEFAULT_USER_PROFILE,
      ...profile,
      aiSummary: profile?.aiSummary ?? null,
      aiSummaryUpdatedAt: profile?.aiSummaryUpdatedAt ?? null,
    };
  }

  private async buildSummaryContext(): Promise<{
    snapshot: UserProfileLibrarySnapshot;
    promptContext: string;
  }> {
    const profile = this.normalizeProfile(getUserProfile());
    const snapshot = await this.buildLibrarySnapshot();
    const papers = await this.papersRepository.list({});
    const recentTitles = [...papers]
      .sort(
        (left, right) =>
          new Date(right.lastReadAt ?? right.createdAt ?? 0).getTime() -
          new Date(left.lastReadAt ?? left.createdAt ?? 0).getTime(),
      )
      .slice(0, 8)
      .map((paper) => paper.title);

    const promptContext = [
      `Name: ${profile.name || 'Not provided'}`,
      `Title: ${profile.title || 'Not provided'}`,
      `Organization: ${profile.organization || 'Not provided'}`,
      `Bio: ${profile.bio || 'Not provided'}`,
      `Research interests: ${profile.researchInterests || 'Not provided'}`,
      `Current goals: ${profile.goals || 'Not provided'}`,
      `Library paper count: ${snapshot.totalPapers}`,
      `Top tags: ${snapshot.topTags.map((tag) => `${tag.name} (${tag.count})`).join(', ') || 'None'}`,
      `Top authors: ${snapshot.topAuthors.map((author) => `${author.name} (${author.count})`).join(', ') || 'None'}`,
      `Active years: ${snapshot.years.map((item) => `${item.year} (${item.count})`).join(', ') || 'None'}`,
      `Recent paper titles: ${recentTitles.join('; ') || 'None'}`,
    ].join('\n');

    return { snapshot, promptContext };
  }

  private async buildLibrarySnapshot(): Promise<UserProfileLibrarySnapshot> {
    const papers = await this.papersRepository.list({});
    const tagCounts = new Map<string, number>();
    const authorCounts = new Map<string, number>();
    const yearCounts = new Map<number, number>();

    for (const paper of papers) {
      for (const tag of paper.tagNames ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }

      for (const author of paper.authors ?? []) {
        authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
      }

      if (paper.submittedAt) {
        const year = new Date(paper.submittedAt).getFullYear();
        if (!Number.isNaN(year)) {
          yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
        }
      }
    }

    return {
      totalPapers: papers.length,
      topTags: Array.from(tagCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      topAuthors: Array.from(authorCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      years: Array.from(yearCounts.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year),
    };
  }
}

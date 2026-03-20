/**
 * Overleaf Service
 *
 * Provides read-only access to Overleaf projects via session cookie authentication.
 * Based on reverse-engineered API from VS Code Overleaf Workshop extension.
 *
 * Note: Overleaf does not have an official public API. This service uses
 * internal web APIs accessed via session cookie (overleaf_session2).
 */

import * as fs from 'fs';
import * as path from 'path';
import { proxyFetch } from './proxy-fetch';
import { getOverleafSessionCookie, getPapersDir } from '../store/app-settings-store';
import { getProxy, getProxyEnabled, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';

const OVERLEAF_BASE_URL = 'https://www.overleaf.com';

export interface OverleafProject {
  id: string;
  name: string;
  lastUpdated: string;
  lastUpdatedBy?: string;
  owner?: { id: string; email: string };
  archived: boolean;
  trashed: boolean;
  accessLevel?: 'owner' | 'readWrite' | 'readOnly';
}

export interface OverleafProjectDetail extends OverleafProject {
  pdfUrl?: string;
  lastCompiledAt?: string;
}

export interface OverleafImportResult {
  paperId: string;
  shortId: string;
  title: string;
  pdfPath: string;
  success: boolean;
  error?: string;
}

/** Proxy agent only for PDF downloads, not for Overleaf API calls */
function getProxyAgentForDownload(): Agent | undefined {
  const proxy = getProxy();
  const proxyEnabled = getProxyEnabled();
  const scope = getProxyScope();
  if (!proxyEnabled || !proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

function getAuthHeaders(): Record<string, string> {
  const cookie = getOverleafSessionCookie();
  if (!cookie) {
    throw new Error('Overleaf session cookie not configured');
  }
  // Cookie value might be URL encoded, use as-is since Overleaf expects it that way
  console.log(
    '[overleaf] Using cookie (length:',
    cookie.length,
    ', preview:',
    cookie.slice(0, 20) + '...)',
  );
  return {
    Cookie: `overleaf_session2=${cookie}`,
  };
}

/**
 * Overleaf Service class for interacting with Overleaf APIs
 */
export class OverleafService {
  /**
   * Validate that the session cookie is still valid
   */
  async validateSession(): Promise<boolean> {
    try {
      // Quick auth check via /user/projects (lightweight, returns JSON)
      const response = await proxyFetch(`${OVERLEAF_BASE_URL}/user/projects`, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          Accept: 'application/json',
        },
        timeoutMs: 15_000,
      });
      console.log('[overleaf] validateSession: status', response.status);
      return response.ok;
    } catch (e) {
      console.error(
        '[overleaf] validateSession failed:',
        e instanceof Error ? e.message : String(e),
      );
      return false;
    }
  }

  /**
   * List all accessible Overleaf projects
   */
  async listProjects(): Promise<OverleafProject[]> {
    // Step 1: Get CSRF token from the dashboard page
    const dashResponse = await proxyFetch(`${OVERLEAF_BASE_URL}/project`, {
      method: 'GET',
      headers: getAuthHeaders(),
      timeoutMs: 30_000,
    });

    if (dashResponse.status === 401 || dashResponse.status === 403) {
      throw new Error('Session expired or invalid. Please re-enter your Overleaf cookie.');
    }

    const html = dashResponse.text();
    const csrfMatch = html.match(/<meta\s+name="ol-csrfToken"\s+content="([^"]*)"/);
    if (!csrfMatch) {
      throw new Error('Could not extract CSRF token from Overleaf dashboard');
    }
    const csrfToken = csrfMatch[1];

    // Step 2: POST /api/project to get full project data with dates
    console.log('[overleaf] Fetching projects via POST /api/project');
    const apiResponse = await proxyFetch(`${OVERLEAF_BASE_URL}/api/project`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Csrf-Token': csrfToken,
      },
      body: JSON.stringify({ _csrf: csrfToken }),
      timeoutMs: 30_000,
    });

    if (!apiResponse.ok) {
      console.log('[overleaf] POST /api/project failed:', apiResponse.status);
      // Fallback to /user/projects (no dates)
      return this.listProjectsFallback();
    }

    const body = apiResponse.text();
    console.log(
      '[overleaf] /api/project response length:',
      body.length,
      ', preview:',
      body.slice(0, 300),
    );

    const data = JSON.parse(body) as {
      projects?: Array<Record<string, unknown>>;
      totalSize?: number;
    };

    const projects = data.projects ?? (Array.isArray(data) ? data : []);
    console.log(
      '[overleaf] Got',
      (projects as Array<unknown>).length,
      'projects from /api/project',
    );
    if ((projects as Array<unknown>).length > 0) {
      const sample = (projects as Array<Record<string, unknown>>)[0];
      console.log('[overleaf] Sample project fields:', JSON.stringify(Object.keys(sample)));
    }
    return this.mapProjects(projects as Array<Record<string, unknown>>);
  }

  /** Fallback: /user/projects (no date info) */
  private async listProjectsFallback(): Promise<OverleafProject[]> {
    const response = await proxyFetch(`${OVERLEAF_BASE_URL}/user/projects`, {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
      },
      timeoutMs: 30_000,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: HTTP ${response.status}`);
    }
    const data = JSON.parse(response.text()) as { projects?: Array<Record<string, unknown>> };
    return this.mapProjects(data.projects ?? []);
  }

  private mapProjects(projects: Array<Record<string, unknown>>): OverleafProject[] {
    // Log first project to debug field names
    if (projects.length > 0) {
      console.log('[overleaf] Sample project fields:', JSON.stringify(Object.keys(projects[0])));
      console.log('[overleaf] Sample project data:', JSON.stringify(projects[0]).slice(0, 500));
    }
    return projects.map((p) => ({
      id: (p.id ?? p._id) as string,
      name: p.name as string,
      lastUpdated: (p.lastUpdated ?? p.lastUpdatedAt ?? p.updatedAt ?? '') as string,
      lastUpdatedBy: (p.lastUpdatedBy as { email?: string })?.email,
      owner: p.owner as { id: string; email: string } | undefined,
      archived: !!p.archived,
      trashed: !!p.trashed,
      accessLevel: p.accessLevel as OverleafProject['accessLevel'],
    }));
  }

  /**
   * Get CSRF token from a project page's HTML
   */
  private async getCsrfToken(projectId: string): Promise<string> {
    const response = await proxyFetch(`${OVERLEAF_BASE_URL}/project/${projectId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
      timeoutMs: 30_000,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Session expired or invalid. Please re-enter your Overleaf cookie.');
    }

    const html = response.text();
    const match = html.match(/<meta\s+name="ol-csrfToken"\s+content="([^"]*)"/);
    if (!match) {
      throw new Error('Could not extract CSRF token from Overleaf project page');
    }
    console.log('[overleaf] Got CSRF token');
    return match[1];
  }

  /**
   * Get details for a specific project by looking it up in the project list
   */
  async getProjectDetails(projectId: string): Promise<OverleafProjectDetail> {
    const projects = await this.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    return { ...project };
  }

  /**
   * Compile a project and download the resulting PDF
   */
  async downloadProjectPdf(projectId: string, outputPath: string): Promise<void> {
    // Step 1: Get CSRF token
    const csrfToken = await this.getCsrfToken(projectId);

    // Step 2: Trigger compile
    console.log('[overleaf] Triggering compile for project:', projectId);
    const compileResponse = await proxyFetch(
      `${OVERLEAF_BASE_URL}/project/${projectId}/compile?auto_compile=true`,
      {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
          'X-Csrf-Token': csrfToken,
        },
        body: JSON.stringify({
          _csrf: csrfToken,
          check: 'silent',
          draft: false,
          incrementalCompilesEnabled: true,
          rootDoc_id: null,
          stopOnFirstError: false,
        }),
        timeoutMs: 120_000,
      },
    );

    if (!compileResponse.ok) {
      const body = compileResponse.text();
      console.log('[overleaf] Compile failed:', compileResponse.status, body.slice(0, 200));
      throw new Error(`Compile failed: HTTP ${compileResponse.status}`);
    }

    const compileResult = JSON.parse(compileResponse.text()) as {
      status: string;
      outputFiles?: Array<{ path: string; url: string; type: string; build: string }>;
    };

    console.log('[overleaf] Compile status:', compileResult.status);

    if (compileResult.status !== 'success') {
      throw new Error(`Compile failed with status: ${compileResult.status}`);
    }

    // Step 3: Find PDF in output files
    const pdfFile = compileResult.outputFiles?.find(
      (f) => f.path === 'output.pdf' || f.type === 'pdf',
    );
    if (!pdfFile) {
      throw new Error('No PDF output found in compile results');
    }

    // Step 4: Download the PDF
    const pdfUrl = pdfFile.url.startsWith('http')
      ? pdfFile.url
      : `${OVERLEAF_BASE_URL}${pdfFile.url}`;
    console.log('[overleaf] Downloading PDF from:', pdfUrl);
    await this.downloadFile(pdfUrl, outputPath);
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await proxyFetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
      agent: getProxyAgentForDownload(),
      timeoutMs: 120_000,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Session expired or invalid. Please re-enter your Overleaf cookie.');
    }

    if (!response.ok) {
      throw new Error(`Failed to download PDF: HTTP ${response.status}`);
    }

    // Validate PDF magic bytes
    const header = response.body.slice(0, 4);
    if (header.toString() !== '%PDF') {
      throw new Error('Downloaded file is not a valid PDF');
    }

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, response.body);
  }

  /**
   * Generate a unique short ID for an Overleaf project
   */
  generateShortId(projectId: string): string {
    return `overleaf-${projectId}`;
  }

  /**
   * Import a project as a paper (returns info for PapersService to create the record)
   */
  async prepareProjectImport(
    projectId: string,
  ): Promise<{ shortId: string; title: string; pdfPath: string; sourceUrl: string }> {
    const details = await this.getProjectDetails(projectId);
    const shortId = this.generateShortId(projectId);
    const papersDir = getPapersDir();
    const pdfPath = path.join(papersDir, shortId, 'paper.pdf');

    await this.downloadProjectPdf(projectId, pdfPath);

    return {
      shortId,
      title: details.name,
      pdfPath,
      sourceUrl: `${OVERLEAF_BASE_URL}/project/${projectId}`,
    };
  }
}

// Export singleton instance
export const overleafService = new OverleafService();

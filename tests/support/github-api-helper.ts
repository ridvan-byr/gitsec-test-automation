import { APIRequestContext } from '@playwright/test';

export interface GitHubRepoState {
  owner: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
}

export class GitHubApiHelper {
  readonly request: APIRequestContext;
  readonly token: string;

  constructor(request: APIRequestContext, token?: string) {
    this.request = request;
    this.token = token || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.E2E_GITHUB_TOKEN || '';
  }

  private get headers() {
    const headersConfig: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headersConfig['Authorization'] = `Bearer ${this.token}`;
    }
    return headersConfig;
  }

  /**
   * Token sahibi olan GitHub kullanıcısının kullanıcı adını döner (ör. ridvan-byr)
   */
  async getAuthenticatedUsername(): Promise<string | null> {
    try {
      const resp = await this.request.get('https://api.github.com/user', {
        headers: this.headers,
      });
      if (resp.ok()) {
        const body = await resp.json();
        return body.login || null;
      }
    } catch {}
    return null;
  }

  /**
   * Token sahibinin erişebildiği repoların listesini döner
   */
  async getUserRepos(): Promise<Array<{ name: string; owner: string; isPrivate: boolean; isArchived: boolean }>> {
    try {
      const resp = await this.request.get('https://api.github.com/user/repos?per_page=50&sort=updated', {
        headers: this.headers,
      });
      if (resp.ok()) {
        const body = await resp.json();
        return body.map((r: any) => ({
          name: r.name,
          owner: r.owner?.login,
          isPrivate: !!r.private,
          isArchived: !!r.archived,
        }));
      }
    } catch {}
    return [];
  }

  /**
   * Fetches detailed status of a repository from GitHub API
   */
  async getRepoState(owner: string, repo: string): Promise<GitHubRepoState | null> {
    try {
      const resp = await this.request.get(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: this.headers,
      });

      if (!resp.ok()) {
        console.log(`⚠️ [GITHUB API] Repo bilgisi alınamadı (${owner}/${repo}): HTTP ${resp.status()}`);
        return null;
      }

      const body = await resp.json();
      return {
        owner: body.owner?.login || owner,
        name: body.name,
        isPrivate: !!body.private,
        isArchived: !!body.archived,
      };
    } catch (err) {
      console.log(`⚠️ [GITHUB API] Repo sorgulama hatası: ${err}`);
      return null;
    }
  }

  /**
   * Updates repository name on GitHub
   */
  async updateRepoName(owner: string, currentRepoName: string, newRepoName: string): Promise<boolean> {
    console.log(`🛠️ [GITHUB API] Repo adı değiştiriliyor: "${currentRepoName}" ➔ "${newRepoName}"`);
    try {
      const resp = await this.request.patch(`https://api.github.com/repos/${owner}/${currentRepoName}`, {
        headers: this.headers,
        data: { name: newRepoName },
      });

      if (resp.ok()) {
        console.log(`✅ [GITHUB API] Repo adı başarıyla güncellendi: "${newRepoName}"`);
        return true;
      } else {
        const errorText = await resp.text().catch(() => '');
        console.log(`❌ [GITHUB API] Repo adı değiştirilemedi (HTTP ${resp.status()}): ${errorText}`);
        return false;
      }
    } catch (err) {
      console.log(`❌ [GITHUB API] Repo adı değiştirme hatası: ${err}`);
      return false;
    }
  }

  /**
   * Updates repository visibility (Private <-> Public) on GitHub
   */
  async updateRepoVisibility(owner: string, repoName: string, isPrivate: boolean): Promise<boolean> {
    const visibilityText = isPrivate ? 'Private' : 'Public';
    console.log(`🛠️ [GITHUB API] Repo görünürlüğü değiştiriliyor (${repoName}): ➔ ${visibilityText}`);
    try {
      const resp = await this.request.patch(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers: this.headers,
        data: { private: isPrivate },
      });

      if (resp.ok()) {
        console.log(`✅ [GITHUB API] Repo görünürlüğü başarıyla güncellendi: ${visibilityText}`);
        return true;
      } else {
        const errorText = await resp.text().catch(() => '');
        console.log(`❌ [GITHUB API] Görünürlük değiştirilemedi (HTTP ${resp.status()}): ${errorText}`);
        return false;
      }
    } catch (err) {
      console.log(`❌ [GITHUB API] Görünürlük değiştirme hatası: ${err}`);
      return false;
    }
  }

  /**
   * Updates repository archiving status (Archive <-> Unarchive) on GitHub
   */
  async updateRepoArchived(owner: string, repoName: string, isArchived: boolean): Promise<boolean> {
    const archiveText = isArchived ? 'Arşivlendi (Archived)' : 'Aktif (Unarchived)';
    console.log(`🛠️ [GITHUB API] Repo arşiv durumu değiştiriliyor (${repoName}): ➔ ${archiveText}`);
    try {
      const resp = await this.request.patch(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers: this.headers,
        data: { archived: isArchived },
      });

      if (resp.ok()) {
        console.log(`✅ [GITHUB API] Repo arşiv durumu başarıyla güncellendi: ${archiveText}`);
        return true;
      } else {
        const errorText = await resp.text().catch(() => '');
        console.log(`❌ [GITHUB API] Arşiv durumu değiştirilemedi (HTTP ${resp.status()}): ${errorText}`);
        return false;
      }
    } catch (err) {
      console.log(`❌ [GITHUB API] Arşiv durumu değiştirme hatası: ${err}`);
      return false;
    }
  }

  /**
   * Guarantees restoration of original repository state during teardown
   */
  async restoreRepoState(currentOwner: string, currentRepoName: string, originalState: GitHubRepoState): Promise<void> {
    console.log(`\n🧹 ========================================================`);
    console.log(`🧹 [TEARDOWN] GitHub reposu orijinal durumuna geri çevriliyor...`);

    // 1. Unarchive if currently archived
    if (originalState.isArchived === false) {
      await this.updateRepoArchived(currentOwner, currentRepoName, false);
    }

    // 2. Restore Visibility if changed
    await this.updateRepoVisibility(currentOwner, currentRepoName, originalState.isPrivate);

    // 3. Restore Name if changed
    if (currentRepoName !== originalState.name) {
      await this.updateRepoName(currentOwner, currentRepoName, originalState.name);
    }

    // 4. Restore archive status if originally archived
    if (originalState.isArchived === true) {
      await this.updateRepoArchived(currentOwner, originalState.name, true);
    }

    console.log(`🧹 [TEARDOWN] Repo başarıyla orijinal durumuna (${originalState.name}) getirildi.`);
    console.log(`🧹 ========================================================\n`);
  }
}

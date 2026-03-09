import { CollectionsRepository } from '@db';

export class CollectionsService {
  private repo = new CollectionsRepository();

  async ensureDefaults() {
    return this.repo.ensureDefaults();
  }

  async create(data: { name: string; icon?: string; color?: string; description?: string }) {
    return this.repo.create(data);
  }

  async list() {
    return this.repo.list();
  }

  async findById(id: string) {
    return this.repo.findById(id);
  }

  async update(
    id: string,
    data: { name?: string; icon?: string; color?: string; description?: string },
  ) {
    return this.repo.update(id, data);
  }

  async delete(id: string) {
    return this.repo.delete(id);
  }

  async addPaper(collectionId: string, paperId: string) {
    return this.repo.addPaper(collectionId, paperId);
  }

  async removePaper(collectionId: string, paperId: string) {
    return this.repo.removePaper(collectionId, paperId);
  }

  async addPapers(collectionId: string, paperIds: string[]) {
    return this.repo.addPapers(collectionId, paperIds);
  }

  async listPapers(collectionId: string) {
    return this.repo.listPapers(collectionId);
  }

  async getCollectionsForPaper(paperId: string) {
    return this.repo.getCollectionsForPaper(paperId);
  }

  async getResearchProfile(collectionId: string) {
    return this.repo.getResearchProfile(collectionId);
  }
}

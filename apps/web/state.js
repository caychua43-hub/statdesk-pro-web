import { validateDataset, validateConfig } from '../../packages/core/index.js';
export class AppState {
    project = null;
    result = null;
    dirty = false;
    resultStale = false;
    generation = 0;
    replace(p) { const dataset = validateDataset(p.dataset); const config = validateConfig(p.config, dataset); this.generation++; this.project = { dataset, config }; this.result = null; this.resultStale = false; this.dirty = true; }
    update(config) { if (!this.project)
        return; this.project = { dataset: this.project.dataset, config: validateConfig(config, this.project.dataset) }; this.generation++; this.dirty = true; this.invalidateResult(); }
    projectRemoved(id) { if (this.project?.dataset.id === id)
        this.dirty = true; }
    invalidateResult() { if (this.result !== null)
        this.resultStale = true; }
    start() { this.invalidateResult(); return ++this.generation; }
    fail(id) { return id === this.generation; }
    cancel() { this.generation++; }
    complete(id, result) { if (id !== this.generation)
        return false; this.result = result; this.resultStale = false; return true; }
}

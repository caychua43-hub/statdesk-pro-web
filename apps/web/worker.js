import { analyze } from '../../packages/core/index.js';
import { analyzePro } from '../../packages/core/pro.js';
self.onmessage = (event) => { const { id, project, pro } = event.data; try {
    const started = performance.now();
    const result = pro ? analyzePro(project.dataset, project.config, pro) : analyze(project.dataset, project.config);
    self.postMessage({ id, result, elapsed: performance.now() - started });
}
catch (e) {
    const x = e;
    self.postMessage({ id, error: { message: x.message, code: x.code, issues: x.issues, issueCount: x.issueCount } });
} };

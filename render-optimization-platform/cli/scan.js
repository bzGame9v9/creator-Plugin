#!/usr/bin/env node
'use strict';

const path = require('path');
const { scanProject } = require('../core/scanner');
const { writeReport } = require('../core/report');

async function main() {
    const projectRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..'));
    const outputDirectory = path.resolve(process.argv[3] || path.join(projectRoot, 'build', 'render-optimization-reports'));
    const report = await scanProject(projectRoot, {
        onProgress(progress) {
            if (process.stdout.isTTY) {
                const total = progress.total ? ` ${progress.current}/${progress.total}` : '';
                process.stdout.write(`\r[${progress.phase}]${total} ${progress.message}`.padEnd(90));
            }
        },
    });
    if (process.stdout.isTTY) process.stdout.write('\n');
    const output = await writeReport(report, outputDirectory);
    console.log(JSON.stringify({
        project: report.project.path,
        durationMs: report.durationMs,
        summary: report.summary,
        output,
    }, null, 2));
}

main().catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 1;
});

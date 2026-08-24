'use strict';

const PACKAGE_NAME = 'asset-reference-finder';

const TEXT = {
    title: '\u8d44\u6e90\u5f15\u7528',
    waiting: '\u7b49\u5f85\u67e5\u8be2...',
    copy: '\u590d\u5236\u8def\u5f84',
    clean: '\u6e05\u7406\u5197\u4f59',
    hint: '\u5728\u8d44\u6e90\u7ba1\u7406\u5668\u4e2d\u9009\u4e2d\u56fe\u7247\u540e\u6309 F6\u3002',
    noResult: '\u6ca1\u6709\u53ef\u663e\u793a\u7684\u67e5\u8be2\u7ed3\u679c\u3002',
    noReferences: '\u672a\u88ab\u5f15\u7528',
    noReferencesBody: '\u8fd9\u4e2a\u8d44\u6e90\u6ca1\u6709\u88ab\u5f15\u7528\u3002',
    possibleString: '\u8def\u5f84\u5b57\u7b26\u4e32\u5339\u914d',
    hiddenData: '\u9690\u85cf/\u5d4c\u5957\u6570\u636e',
    relations: '\u5173\u8054',
    cleanupTitle: '\u53d1\u73b0\u53ef\u6e05\u7406\u7684\u9690\u85cf\u65e7\u6570\u636e',
    cleanupNone: '\u672a\u53d1\u73b0\u53ef\u81ea\u52a8\u6e05\u7406\u7684\u9690\u85cf\u5197\u4f59\u3002',
    keyPoint: '\u5173\u952e\u70b9',
    hiddenSelfRoot: '\u9690\u85cf\u65e7\u526f\u672c',
    staleOverride: '\u5931\u6548\u6302\u94a9',
    cleanupDone: '\u6e05\u7406\u5b8c\u6210',
    cleanupFailed: '\u6e05\u7406\u5931\u8d25',
};

exports.template = /* html */ `
<div class="wrap">
  <header class="header">
    <div>
      <div id="title" class="title">${TEXT.title}</div>
      <div id="assetPath" class="asset-path">${TEXT.waiting}</div>
    </div>
    <div class="actions">
      <ui-button id="cleanBtn" class="clean">${TEXT.clean}</ui-button>
      <ui-button id="copyBtn" class="copy">${TEXT.copy}</ui-button>
    </div>
  </header>
  <main id="content" class="content">
    <div class="empty">${TEXT.hint}</div>
  </main>
</div>
`;

exports.style = /* css */ `
  :host {
    display: flex;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill);
  }

  .wrap {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    font-size: 13px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }

  .asset-path {
    max-width: 390px;
    margin-top: 2px;
    opacity: 0.66;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: Consolas, "Courier New", monospace;
    font-size: 12px;
  }

  .actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
  }

  .copy,
  .clean {
    flex: 0 0 auto;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px 16px;
  }

  .empty {
    padding: 28px 0;
    text-align: center;
    opacity: 0.72;
    line-height: 1.8;
  }

  .tree {
    font-family: Consolas, "Courier New", monospace;
    font-size: 13px;
    line-height: 23px;
    user-select: text;
  }

  .node {
    min-width: max-content;
  }

  .row {
    display: flex;
    align-items: center;
    min-height: 23px;
    white-space: nowrap;
  }

  .twisty {
    width: 14px;
    flex: 0 0 14px;
    opacity: 0.72;
    cursor: default;
  }

  .name {
    padding: 0 4px;
    border-radius: 2px;
  }

  .file > .row > .name {
    color: var(--color-success-fill);
  }

  .folder > .row > .name {
    color: var(--color-info-fill);
  }

  .scene-node > .row > .name {
    color: var(--color-normal-contrast);
  }

  .hidden-data > .row > .name {
    color: var(--color-warn-fill);
  }

  .relation > .row > .name {
    color: var(--color-warn-fill);
  }

  .tag {
    margin-left: 6px;
    opacity: 0.58;
    font-size: 12px;
  }

  .node.collapsed > .children {
    display: none;
  }

  .summary {
    min-width: 520px;
    max-width: 900px;
    line-height: 1.7;
  }

  .summary-title {
    margin-bottom: 8px;
    color: var(--color-warn-fill);
    font-size: 14px;
    font-weight: 600;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 12px;
    row-gap: 4px;
    font-family: Consolas, "Courier New", monospace;
  }

  .summary-label {
    color: var(--color-normal-contrast);
    opacity: 0.68;
  }

  .summary-value {
    color: var(--color-normal-contrast);
    word-break: break-all;
  }

  .summary-list {
    margin-top: 12px;
    font-family: Consolas, "Courier New", monospace;
  }

  .summary-item {
    color: var(--color-warn-fill);
    white-space: nowrap;
  }

  .notice {
    margin-top: 12px;
    opacity: 0.72;
  }
`;

exports.$ = {
    title: '#title',
    assetPath: '#assetPath',
    copyBtn: '#copyBtn',
    cleanBtn: '#cleanBtn',
    content: '#content',
};

let latestResult = null;

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function stripAssetsPrefix(filePath) {
    return String(filePath || '').replace(/\\/g, '/').replace(/^assets\//, '');
}

function ensureTreePath(root, pathParts, kind) {
    let node = root;
    pathParts.forEach((part, index) => {
        if (!node.children.has(part)) {
            node.children.set(part, {
                name: part,
                children: new Map(),
                kind: 'folder',
                fullPath: pathParts.slice(0, index + 1).join('/'),
            });
        }
        node = node.children.get(part);
        if (index === pathParts.length - 1) {
            node.kind = kind;
        }
    });
    return node;
}

function formatSceneNodeName(name, nodeReference, isLeaf) {
    if (!isLeaf || !nodeReference) {
        return name;
    }

    const tags = [];
    const componentTypes = nodeReference.componentTypes || [];
    if (componentTypes.length) {
        tags.push(componentTypes.join(', '));
    }
    if (nodeReference.active === false) {
        tags.push('inactive');
    }
    if (nodeReference.reachable === false) {
        tags.push('hidden data');
    }

    return {
        text: name,
        tag: tags.length ? tags.join(' / ') : '',
    };
}

function formatRelationKind(relation) {
    if (relation.kind === 'target override') {
        return 'prefab override';
    }
    return relation.kind === 'prefab asset' && relation.count
        ? `${relation.kind} x${relation.count}`
        : relation.kind;
}

function formatRelationName(relation) {
    const property = relation.propertyPath || relation.fieldPath || '';
    const target = relation.targetPath || relation.targetRootPath || relation.nodePath || '';

    if (relation.kind === 'target override' && property && target) {
        return `${property} -> ${target}`;
    }
    if (relation.kind === 'script field' && property && target) {
        return `${relation.nodePath || relation.objectType || 'script'} . ${property} -> ${target}`;
    }
    if (relation.kind === 'prefab instance root' && target) {
        return `prefabRootNode -> ${target}`;
    }
    if (relation.kind === 'prefab asset' && target) {
        return target;
    }

    return relation.nodePath || target || relation.objectType || 'relation';
}

function formatRelationDetail(relation) {
    return [
        formatRelationKind(relation),
        relation.objectType,
        Number.isInteger(relation.objectId) ? `#${relation.objectId}` : '',
        relation.ownerRootPath ? `owner ${relation.ownerRootPath}` : '',
        Number.isInteger(relation.ownerPrefabInfoId) ? `ownerInfo #${relation.ownerPrefabInfoId}` : '',
        Number.isInteger(relation.targetInfoId) ? `targetInfo #${relation.targetInfoId}` : '',
        relation.targetLocalId ? `localID ${relation.targetLocalId}` : '',
        relation.reachable === false || relation.targetReachable === false || relation.ownerReachable === false ? 'hidden data' : '',
    ].filter(Boolean).join(' / ');
}

function buildTree(items) {
    const root = { name: '', children: new Map(), kind: 'root', fullPath: '' };
    for (const item of items) {
        const originalPath = typeof item === 'string' ? item : item.path;
        const displayPath = stripAssetsPrefix(originalPath);
        const parts = displayPath.split('/').filter(Boolean);
        const fileNode = ensureTreePath(root, parts, 'file');
        const nodeReferences = item && item.nodeReferences ? item.nodeReferences : [];
        for (const nodeReference of nodeReferences) {
            const nodeParts = String(nodeReference.path || '').split('/').filter(Boolean);
            if (!nodeParts.length) {
                continue;
            }
            const parentNode = nodeReference.reachable === false
                ? ensureTreePath(fileNode, [TEXT.hiddenData], 'hidden-data')
                : fileNode;
            let node = parentNode;
            nodeParts.forEach((part, index) => {
                const formatted = formatSceneNodeName(part, nodeReference, index === nodeParts.length - 1);
                const nodeName = typeof formatted === 'string' ? formatted : formatted.text;
                if (!node.children.has(nodeName)) {
                    node.children.set(nodeName, {
                        name: nodeName,
                        tag: '',
                        children: new Map(),
                        kind: 'folder',
                        fullPath: nodeParts.slice(0, index + 1).join('/'),
                    });
                }
                node = node.children.get(nodeName);
                if (index === nodeParts.length - 1) {
                    node.kind = nodeReference.reachable === false ? 'hidden-data' : 'scene-node';
                    node.tag = typeof formatted === 'string' ? '' : formatted.tag;
                }
            });
        }
        const assetRelations = item && item.assetRelations ? item.assetRelations : [];
        const relationNode = assetRelations.length
            ? ensureTreePath(fileNode, [TEXT.relations], 'relation')
            : null;
        for (const relation of assetRelations) {
            if (relation.kind === 'prefab owner') {
                continue;
            }
            const main = formatRelationName(relation);
            const detail = formatRelationDetail(relation);
            const relationName = detail ? `${main}  [${detail}]` : main;
            const relationKind = relation.reachable === false || relation.targetReachable === false || relation.ownerReachable === false ? 'hidden-data' : 'relation';
            ensureTreePath(relationNode, [relationName], relationKind);
        }
    }
    return root;
}

function sortNodes(entries) {
    return entries.sort((left, right) => {
        const a = left[1];
        const b = right[1];
        if (a.kind !== b.kind) {
            if (a.kind === 'folder') {
                return -1;
            }
            if (b.kind === 'folder') {
                return 1;
            }
        }
        return a.name.localeCompare(b.name);
    });
}

function renderNode(node, depth) {
    const entries = sortNodes(Array.from(node.children.entries()));
    return entries.map(([, child]) => {
        const hasChildren = child.children.size > 0;
        const typeClass = child.kind || 'folder';
        const indent = depth * 18;
        const arrow = hasChildren ? '\u25be' : '';
        return `
          <div class="node ${typeClass}" data-path="${escapeHtml(child.fullPath)}">
            <div class="row" style="padding-left:${indent}px">
              <span class="twisty">${arrow}</span>
              <span class="name">${escapeHtml(child.name)}</span>
              ${child.tag ? `<span class="tag">${escapeHtml(child.tag)}</span>` : ''}
            </div>
            ${hasChildren ? `<div class="children">${renderNode(child, depth + 1)}</div>` : ''}
          </div>
        `;
    }).join('');
}

function uniqueSorted(paths) {
    return Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b));
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return '';
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
}

function hasCleanupPlan(result) {
    return !!(result && result.cleanupPlan && result.cleanupPlan.canClean);
}

function hasCleanupSummary(result) {
    return hasCleanupPlan(result) || !!(result && result.cleanResult && result.cleanResult.ok && result.cleanResult.plan);
}

function renderCleanupSummary(result) {
    const cleaned = result.cleanResult;
    const plan = hasCleanupPlan(result) ? result.cleanupPlan : cleaned && cleaned.plan;
    const hiddenRoots = plan.hiddenSelfRoots || [];
    const staleOverrides = plan.staleOverrides || [];
    const biggestRoot = hiddenRoots[0];
    const rows = [
        [TEXT.hiddenSelfRoot, biggestRoot ? `${biggestRoot.path} (${biggestRoot.objectCount} objects, ${formatBytes(biggestRoot.approxBytes)})` : ''],
        ['\u9884\u8ba1\u5220\u9664', `${plan.removedObjectCount} objects`],
        ['\u5f53\u524d\u5bf9\u8c61', `${plan.objectCount} objects`],
        ['\u6e05\u7406\u540e', `${plan.reachableAfterCleanupCount} objects`],
    ];

    const overrideLines = staleOverrides.map((item) => `
      <div class="summary-item">
        ${escapeHtml(item.propertyPath || 'override')} -> ${escapeHtml(item.targetPath || `#${item.targetId}`)}
        ${item.targetLocalId ? `<span class="tag">localID ${escapeHtml(item.targetLocalId)}</span>` : ''}
      </div>
    `).join('');

    return `
      <div class="summary">
        <div class="summary-title">${cleaned ? TEXT.cleanupDone : TEXT.cleanupTitle}</div>
        <div class="summary-grid">
          ${rows.map(([label, value]) => `
            <div class="summary-label">${escapeHtml(label)}</div>
            <div class="summary-value">${escapeHtml(value)}</div>
          `).join('')}
          ${cleaned ? `
            <div class="summary-label">\u5907\u4efd</div>
            <div class="summary-value">${escapeHtml(cleaned.backupPath || '')}</div>
            <div class="summary-label">\u4f53\u79ef</div>
            <div class="summary-value">${escapeHtml(formatBytes(cleaned.beforeBytes))} -> ${escapeHtml(formatBytes(cleaned.afterBytes))}</div>
          ` : ''}
        </div>
        <div class="summary-list">
          <div class="summary-label">${TEXT.keyPoint}</div>
          ${overrideLines || `<div class="summary-value">${TEXT.cleanupNone}</div>`}
        </div>
        <div class="notice">\u6309\u4e0b\u201c${TEXT.clean}\u201d\u4f1a\u5148\u5907\u4efd prefab\uff0c\u518d\u5220\u9664\u4e0a\u9762\u8fd9\u4e2a\u5931\u6548\u6302\u94a9\u548c\u7531\u5b83\u62d6\u4f4f\u7684\u9690\u85cf\u65e7\u6570\u636e\u3002</div>
      </div>
    `;
}

function getPrimaryReferencePaths(result) {
    return uniqueSorted((result.references || []).map((item) => item.path));
}

function getPrimaryReferences(result) {
    return (result.references || []).slice().sort((a, b) => a.path.localeCompare(b.path));
}

function getStringReferencePaths(result) {
    return uniqueSorted((result.stringReferences || []).map((item) => item.path));
}

function getDisplayedItems(result) {
    const primary = getPrimaryReferences(result);
    if (primary.length) {
        return primary;
    }
    return getStringReferencePaths(result).map((item) => ({ path: item }));
}

function getCopyLines(result) {
    const primary = getPrimaryReferences(result);
    if (primary.length) {
        const lines = [];
        for (const reference of primary) {
            lines.push(reference.path);
            for (const nodeReference of reference.nodeReferences || []) {
                const tags = [];
                if (nodeReference.componentTypes && nodeReference.componentTypes.length) {
                    tags.push(nodeReference.componentTypes.join(', '));
                }
                if (nodeReference.active === false) {
                    tags.push('inactive');
                }
                if (nodeReference.reachable === false) {
                    tags.push('hidden data');
                }
                lines.push(`  ${nodeReference.path}${tags.length ? ` [${tags.join(' / ')}]` : ''}`);
            }
            for (const relation of reference.assetRelations || []) {
                if (relation.kind === 'prefab owner') {
                    continue;
                }
                const detail = formatRelationDetail(relation);
                const name = formatRelationName(relation);
                lines.push(`  ${name}${detail ? ` [${detail}]` : ''}`);
            }
        }
        return lines;
    }
    return getStringReferencePaths(result);
}

function setCopyButton(panel, enabled) {
    panel.$.copyBtn.disabled = !enabled;
    if (enabled) {
        panel.$.copyBtn.removeAttribute('disabled');
    } else {
        panel.$.copyBtn.setAttribute('disabled', 'true');
    }
}

function setCleanButton(panel, enabled) {
    panel.$.cleanBtn.disabled = !enabled;
    if (enabled) {
        panel.$.cleanBtn.removeAttribute('disabled');
    } else {
        panel.$.cleanBtn.setAttribute('disabled', 'true');
    }
}

function renderResult(result, panel) {
    latestResult = result;
    setCopyButton(panel, !!(result && result.asset));
    setCleanButton(panel, hasCleanupPlan(result));

    if (!result) {
        panel.$.title.textContent = TEXT.title;
        panel.$.assetPath.textContent = TEXT.waiting;
        panel.$.content.innerHTML = `<div class="empty">${TEXT.hint}</div>`;
        return;
    }

    if (!result.ok) {
        panel.$.title.textContent = TEXT.title;
        panel.$.assetPath.textContent = '';
        panel.$.content.innerHTML = `<div class="empty">${escapeHtml(result.message || TEXT.noResult)}</div>`;
        return;
    }

    const assetPath = stripAssetsPrefix(result.asset.path || result.asset.dbUrl || '');
    const primaryPaths = getPrimaryReferencePaths(result);
    const displayedItems = getDisplayedItems(result);
    const showingPossibleStrings = !primaryPaths.length && displayedItems.length;

    panel.$.assetPath.textContent = assetPath;

    if (!displayedItems.length) {
        panel.$.title.textContent = TEXT.noReferences;
        panel.$.content.innerHTML = hasCleanupSummary(result)
            ? renderCleanupSummary(result)
            : `<div class="empty">${TEXT.noReferencesBody}</div>`;
        return;
    }

    panel.$.title.textContent = showingPossibleStrings
        ? TEXT.possibleString
        : `\u88ab ${primaryPaths.length} \u4e2a\u6587\u4ef6\u5f15\u7528`;

    if (hasCleanupSummary(result)) {
        panel.$.title.textContent = result.cleanResult && result.cleanResult.ok ? TEXT.cleanupDone : TEXT.cleanupTitle;
        panel.$.content.innerHTML = renderCleanupSummary(result);
        return;
    }

    const tree = buildTree(displayedItems);
    panel.$.content.innerHTML = `<div class="tree">${renderNode(tree, 0)}</div>`;
}

exports.methods = {
    updateResult(result) {
        renderResult(result, this);
    },

    async copyPaths() {
        if (!latestResult) {
            return;
        }
        const text = getCopyLines(latestResult).join('\n');
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            console.warn('[AssetRef] copy failed:', error && (error.stack || error.message) || error);
        }
    },

    async cleanRedundancy() {
        if (!hasCleanupPlan(latestResult)) {
            return;
        }

        setCleanButton(this, false);
        try {
            const result = await Editor.Message.request(PACKAGE_NAME, 'clean-selected-prefab-redundancy');
            if (!result || !result.ok) {
                this.$.content.innerHTML = `<div class="empty">${TEXT.cleanupFailed}: ${escapeHtml(result && result.message || '')}</div>`;
            }
        } catch (error) {
            this.$.content.innerHTML = `<div class="empty">${TEXT.cleanupFailed}: ${escapeHtml(error && (error.message || error.stack) || error)}</div>`;
        } finally {
            setCleanButton(this, hasCleanupPlan(latestResult));
        }
    },
};

exports.ready = async function ready() {
    this.$.copyBtn.addEventListener('confirm', () => this.copyPaths());
    this.$.cleanBtn.addEventListener('confirm', () => this.cleanRedundancy());
    this.$.content.addEventListener('click', (event) => {
        const target = event.target && event.target.closest
            ? event.target
            : event.target && event.target.parentElement;
        const twisty = target && target.closest('.twisty');
        if (!twisty || !twisty.textContent.trim()) {
            return;
        }
        const node = twisty.closest('.node');
        node.classList.toggle('collapsed');
        twisty.textContent = node.classList.contains('collapsed') ? '\u25b8' : '\u25be';
    });

    const result = await Editor.Message.request(PACKAGE_NAME, 'get-last-result');
    renderResult(result, this);
};

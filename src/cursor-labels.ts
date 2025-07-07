import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDocumentManager } from '@jupyterlab/docmanager';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { IDisposable } from '@lumino/disposable';

import { Awareness } from 'y-protocols/awareness';

import {
  Extension,
  Facet,
  StateEffect
} from '@codemirror/state';

import {
  EditorView,
  Decoration,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view';

import {
  createAbsolutePositionFromRelativePosition,
  RelativePosition,
  Text
} from 'yjs';

/**
 * CodeMirror extension for displaying persistent collaborator labels.
 */

/**
 * Yjs document objects
 */
export type EditorAwareness = {
  /**
   * User related information
   */
  awareness: Awareness;
  /**
   * Shared editor source
   */
  ytext: Text;
};

interface ICursorState {
  /**
   * Cursor anchor
   */
  anchor: RelativePosition;
  /**
   * Cursor head
   */
  head: RelativePosition;
  /**
   * Whether the cursor is an empty range or not.
   *
   * Default `true`
   */
  empty?: boolean;
  /**
   * Whether the cursor is the primary one or not.
   *
   * Default `false`
   */
  primary?: boolean;
}

/**
 * Awareness state definition
 */
interface IAwarenessState extends Record<string, any> {
  /**
   * User identity
   */
  user?: {
    name?: string;
    display_name?: string;
    color?: string;
    avatar_url?: string;
    avatarUrl?: string;
    email?: string;
  };
  /**
   * User cursors
   */
  cursors?: ICursorState[];
}

/**
 * Facet storing the Yjs document objects
 */
const editorAwarenessFacet = Facet.define<EditorAwareness, EditorAwareness>({
  combine(configs: readonly EditorAwareness[]) {
    return configs[configs.length - 1];
  }
});

/**
 * Theme for persistent cursor labels
 */
const persistentLabelTheme = EditorView.baseTheme({
  '.jp-PersistentCursorLabel': {
    position: 'fixed',
    pointerEvents: 'none',
    fontSize: '12px',
    fontFamily: 'var(--jp-ui-font-family)',
    whiteSpace: 'nowrap',
    zIndex: '9999'
  },
  '.jp-PersistentCursorLabel-content': {
    display: 'inline-block',
    borderRadius: '12px',
    padding: '4px 12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    opacity: '0.9',
    whiteSpace: 'nowrap'
  },
  '.jp-PersistentCursorLabel-name': {
    color: 'white',
    fontWeight: '500',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
    whiteSpace: 'nowrap',
    display: 'inline'
  }
});


/**
 * Extension for persistent user labels at cursor positions
 */
const persistentUserLabels = ViewPlugin.fromClass(
  class {
    editorAwareness!: EditorAwareness;
    _listener!: (t: {
      added: Array<any>;
      updated: Array<any>;
      removed: Array<any>;
    }) => void;
    decorations: any;
    labelElements: Map<string, HTMLElement> = new Map();
    hideTimers: Map<string, number> = new Map();

    constructor(view: EditorView) {
      try {
        this.editorAwareness = view.state.facet(editorAwarenessFacet);
        this.decorations = Decoration.set([]);
        this.updateOverlayLabels(view);
        
        this._listener = ({ added, updated, removed }) => {
          const clients = added.concat(updated).concat(removed);
          if (
            clients.findIndex(
              id => id !== this.editorAwareness.awareness.doc.clientID
            ) >= 0
          ) {
            requestAnimationFrame(() => {
              this.updateOverlayLabels(view);
            });
          }
        };

        this.editorAwareness.awareness.on('change', this._listener);
      } catch (error) {
        this.decorations = Decoration.set([]);
      }
    }

    destroy(): void {
      this.editorAwareness.awareness.off('change', this._listener);
      
      // Clear all hide timers
      this.hideTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      this.hideTimers.clear();
      
      // Clean up all labels attached to document.body
      this.labelElements.forEach((label) => {
        if (label.parentNode) {
          label.parentNode.removeChild(label);
        }
      });
      this.labelElements.clear();
      
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.length > 0
      ) {
        requestAnimationFrame(() => {
          this.updateOverlayLabels(update.view);
        });
      }
    }

    updateOverlayLabels(view: EditorView): void {
      
      const { awareness, ytext } = this.editorAwareness;
      const ydoc = ytext.doc!;
      const activeUsers = new Set<string>();

      awareness.getStates().forEach((state: IAwarenessState, clientID) => {
        if (clientID === awareness.doc.clientID) {
          return;
        }

        const cursors_ = state.cursors;
        const user = state.user;
        const userName = user?.display_name || user?.name || `User ${clientID}`;
        const userColor = user?.color || '#2196F3';
        const avatarUrl = user?.avatar_url || user?.avatarUrl;
        const userKey = `${clientID}-${userName}`;

        activeUsers.add(userKey);

        for (const cursor of cursors_ ?? []) {
          if (!cursor?.head) continue;

          let head = createAbsolutePositionFromRelativePosition(
            cursor.head,
            ydoc
          );
          
          // Only create label if cursor belongs to this cell's ytext
          if (!head || head.type !== ytext) continue;

          // Get the current document state
          const docLength = view.state.doc.length;
          let position = head.index;
          
          // Basic bounds checking
          if (position < 0) {
            position = 0;
          } else if (position > docLength) {
            position = docLength;
          }
          
          try {
            const coords = view.coordsAtPos(position);
            
            if (!coords) {
              continue;
            }
            
            // Get or create label element
            let label = this.labelElements.get(userKey);
            if (!label) {
              label = this.createLabelElement(userName, userColor, avatarUrl);
              this.labelElements.set(userKey, label);
              // Append to document body for fixed positioning to work above everything
              document.body.appendChild(label);
            }
            
            // Use fixed positioning relative to viewport to hover above everything
            label.style.position = 'fixed';
            label.style.left = `${coords.left}px`;
            label.style.top = `${coords.top - 12}px`; // 12px above cursor
            label.style.visibility = 'visible';
            label.style.opacity = '0.9';
            
            // Clear any existing hide timer for this user
            const existingTimer = this.hideTimers.get(userKey);
            if (existingTimer) {
              clearTimeout(existingTimer);
            }
            
            // Set a new timer to hide the label after inactivity
            const hideTimer = window.setTimeout(() => {
              const currentLabel = this.labelElements.get(userKey);
              if (currentLabel) {
                currentLabel.style.opacity = '0';
                currentLabel.style.visibility = 'hidden';
              }
              this.hideTimers.delete(userKey);
            }, 500);
            
            this.hideTimers.set(userKey, hideTimer);
            
          } catch (error) {
            // Silently continue if position can't be resolved
          }
        }
      });

      // Remove labels for users who are no longer active
      this.labelElements.forEach((label, userKey) => {
        if (!activeUsers.has(userKey)) {
          // Clear any hide timer for this user
          const timer = this.hideTimers.get(userKey);
          if (timer) {
            clearTimeout(timer);
            this.hideTimers.delete(userKey);
          }
          
          // Remove the label
          if (label.parentNode) {
            label.parentNode.removeChild(label);
          }
          this.labelElements.delete(userKey);
        }
      });
    }

    createLabelElement(userName: string, userColor: string, avatarUrl?: string): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'jp-PersistentCursorLabel';
      
      const content = document.createElement('div');
      content.className = 'jp-PersistentCursorLabel-content';
      content.style.backgroundColor = userColor;
      
      // Add name only (no icon/initials)
      const nameElement = document.createElement('div');
      nameElement.className = 'jp-PersistentCursorLabel-name';
      nameElement.textContent = userName;
      content.appendChild(nameElement);
      
      wrap.appendChild(content);
      
      return wrap;
    }


  },
  {
    decorations: (v: any) => v.decorations,
    provide: () => persistentLabelTheme
  }
);

/**
 * CodeMirror extension to display persistent user labels at cursor positions
 *
 * @param config Editor source and awareness
 * @returns CodeMirror extension
 */
export function persistentUserCursorLabels(config: EditorAwareness): Extension {
  return [editorAwarenessFacet.of(config), persistentUserLabels];
}

/**
 * Widget extension for adding persistent cursor labels to editors
 */
class PersistentCursorLabelsExtension implements DocumentRegistry.IWidgetExtension<any, any> {
  /**
   * Create a new extension for the document widget.
   */
  createNew(
    panel: any,
    context: DocumentRegistry.IContext<any>
  ): IDisposable {
    this._addLabelsToEditor(panel, context);
    
    return {
      dispose: () => {
        // Cleanup handled by CodeMirror extension
      },
      isDisposed: false
    };
  }

  private async _addLabelsToEditor(panel: any, context: DocumentRegistry.IContext<any>): Promise<void> {
    try {
      await context.ready;
      
      if (context.model && 'sharedModel' in context.model) {
        const sharedModel = (context.model as any).sharedModel;
        
        // Check various possible property names
        const awareness = sharedModel.awareness || sharedModel._awareness || sharedModel.doc?.awareness;
        
        if (awareness) {
          // Wait a bit for the editor to be fully initialized
          setTimeout(() => {
            this._findAndEnhanceEditorWithAwareness(panel, awareness, sharedModel);
          }, 500);
        }
      }
    } catch (error) {
      // Silently fail
    }
  }

  private _findAndEnhanceEditorWithAwareness(panel: any, awareness: Awareness, sharedModel: any): void {
    // For file editors
    if (panel.content && panel.content.editor && panel.content.editor.editor) {
      const cmEditor = panel.content.editor.editor;
      
      // For file editors, try to get the ytext from shared model
      const ytext = sharedModel.ytext || sharedModel._ytext || sharedModel.ysource || sharedModel.source;
      
      if (cmEditor.dispatch && ytext) {
        try {
          cmEditor.dispatch({
            effects: [
              StateEffect.appendConfig.of(persistentUserCursorLabels({ awareness, ytext }))
            ]
          });
        } catch (error) {
          // Silently fail
        }
      }
    }
    
    // For notebook cells
    if (panel.content && panel.content.widgets) {
      panel.content.widgets.forEach((cell: any) => {
        if (cell.editor && cell.editor.editor && cell.editor.editor.dispatch) {
          const cmEditor = cell.editor.editor;
          
          // For notebook cells, we need to get the cell's individual ytext
          let cellYtext = null;
          
          if (cell.model && cell.model.sharedModel) {
            cellYtext = cell.model.sharedModel.ysource || cell.model.sharedModel.ytext;
          }
          
          if (cellYtext) {
            try {
              cmEditor.dispatch({
                effects: [
                  StateEffect.appendConfig.of(persistentUserCursorLabels({ awareness, ytext: cellYtext }))
                ]
              });
            } catch (error) {
              // Silently fail
            }
          }
        }
      });
      
      // Listen for new cells
      panel.content.model?.cells.changed.connect(() => {
        setTimeout(() => {
          panel.content.widgets.forEach((cell: any) => {
            if (cell.editor && cell.editor.editor && cell.editor.editor.dispatch) {
              const cmEditor = cell.editor.editor;
              
              let cellYtext = null;
              if (cell.model && cell.model.sharedModel) {
                cellYtext = cell.model.sharedModel.ysource || cell.model.sharedModel.ytext;
              }
              
              if (cellYtext) {
                try {
                  cmEditor.dispatch({
                    effects: [
                      StateEffect.appendConfig.of(persistentUserCursorLabels({ awareness, ytext: cellYtext }))
                    ]
                  });
                } catch (error) {
                  // Extension may already exist, silently continue
                }
              }
            }
          });
        }, 100);
      });
    }
  }
}

/**
 * Persistent cursor labels plugin
 */
const persistentCursorLabelsPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-document-collaborators:persistent-cursor-labels',
  description: 'A JupyterLab extension for showing persistent collaborator names above their cursors',
  autoStart: true,
  requires: [IDocumentManager],
  activate: (app: JupyterFrontEnd, docManager: IDocumentManager) => {
    // Create the extension
    const extension = new PersistentCursorLabelsExtension();
    
    // Register the extension with the document registry for different document types
    app.docRegistry.addWidgetExtension('Notebook', extension);
    app.docRegistry.addWidgetExtension('Editor', extension);
  }
};

export default persistentCursorLabelsPlugin;

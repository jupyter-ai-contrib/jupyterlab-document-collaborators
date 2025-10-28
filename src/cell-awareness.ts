import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDocumentManager } from '@jupyterlab/docmanager';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { IDisposable } from '@lumino/disposable';

import { Widget } from '@lumino/widgets';

import { Awareness } from 'y-protocols/awareness';

import {
  createAbsolutePositionFromRelativePosition,
  RelativePosition
} from 'yjs';

/**
 * Interface representing a collaborator's cell presence
 */
interface ICellCollaborator {
  /** Display name of the collaborator */
  name: string;
  /** Initials derived from the collaborator's name */
  initials: string;
  /** Email address of the collaborator (optional) */
  email?: string;
  /** Color associated with the collaborator */
  color: string;
  /** Unique client ID for the collaborator */
  clientId: number;
  /** Avatar URL for the collaborator (optional) */
  avatar_url?: string;
}

/**
 * Interface for cursor state in awareness
 */
interface ICursorState {
  anchor: RelativePosition;
  head: RelativePosition;
  empty?: boolean;
  primary?: boolean;
}

/**
 * Interface for awareness state
 */
interface IAwarenessState extends Record<string, any> {
  user?: {
    name?: string;
    display_name?: string;
    color?: string;
    avatar_url?: string;
    avatarUrl?: string;
    email?: string;
  };
  cursors?: ICursorState[];
}

/**
 * Generate a consistent color for a user based on their name
 */
function generateUserColor(name: string): string {
  const colors = [
    '#4CAF50',
    '#2196F3',
    '#FF9800',
    '#9C27B0',
    '#F44336',
    '#009688',
    '#795548',
    '#607D8B',
    '#E91E63',
    '#3F51B5',
    '#00BCD4',
    '#8BC34A',
    '#FFC107',
    '#FF5722',
    '#9E9E9E'
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Generate initials from a user's name
 */
function generateInitials(name: string): string {
  if (!name) {
    return '??';
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Widget that displays collaborator presence indicators in notebook cells.
 * Shows small avatar indicators in the bottom-right corner of cells where collaborators are active.
 */
class CellAwarenessWidget extends Widget {
  private _collaboratorsByCellId: Map<string, Map<number, ICellCollaborator>> =
    new Map();
  private _cellElements: Map<string, HTMLElement> = new Map();
  private _indicatorElements: Map<string, HTMLElement> = new Map();
  private _awareness: Awareness | null = null;
  private _sharedModel: any = null;
  private _panel: any = null;
  /** Track the last known cell locations for each user to detect cell changes */
  private _lastUserCellLocations: Map<number, Set<string>> = new Map();
  /** Currently displayed modal element */
  private _currentModal: HTMLDivElement | null = null;
  /** Timer ID for hiding modal with delay */
  private _hideModalTimeout: NodeJS.Timeout | null = null;

  /**
   * Construct a new CellAwarenessWidget
   */
  constructor(panel: any, context?: DocumentRegistry.IContext<any>) {
    super();
    this.addClass('jp-CellAwareness');
    this._panel = panel;

    if (context) {
      this._connectToAwareness(context);
    }
  }

  /**
   * Connect to the document's awareness system to track collaborators
   */
  private _connectToAwareness(context: DocumentRegistry.IContext<any>): void {
    context.ready
      .then(() => {
        if (context.model && 'sharedModel' in context.model) {
          this._sharedModel = (context.model as any).sharedModel;

          if (this._sharedModel && 'awareness' in this._sharedModel) {
            this._awareness = (this._sharedModel as any).awareness as Awareness;

            if (this._awareness) {
              this._awareness.on('change', this._onAwarenessChange.bind(this));
              this._updateCellCollaborators();
            }
          }
        }
      })
      .catch(() => {
        // Context failed to load
      });
  }

  /**
   * Handle changes in collaborator awareness state
   */
  private _onAwarenessChange(): void {
    // Only update if users have actually changed which cells they're in
    const hasChanges = this._detectCellLocationChanges();
    if (hasChanges) {
      this._updateCellCollaborators();
      this._renderCellIndicators();
    }
  }

  /**
   * Detect if any users have changed which cells they're editing
   * Returns true if the UI needs to be updated
   */
  private _detectCellLocationChanges(): boolean {
    if (!this._awareness || !this._panel?.content?.widgets) {
      return false;
    }

    const awarenessStates = this._awareness.getStates();
    const currentUserCellLocations = new Map<number, Set<string>>();

    // Build map of cell ytext to cell ID for efficient lookup
    const ytextToCellId = new Map<any, string>();
    this._panel.content.widgets.forEach((cell: any, index: number) => {
      if (cell.model && cell.model.sharedModel) {
        const ytext =
          cell.model.sharedModel.ysource || cell.model.sharedModel.ytext;
        if (ytext) {
          const cellId = cell.model.id || `cell-${index}`;
          ytextToCellId.set(ytext, cellId);
        }
      }
    });

    // Track current cell locations for each user
    awarenessStates.forEach((state: IAwarenessState, clientId: number) => {
      // Skip our own client
      if (clientId === this._awareness!.clientID) {
        return;
      }

      const user = state.user || {};
      const name = user.name || user.display_name;
      if (!name) {
        return;
      }

      const cellsForUser = new Set<string>();
      const cursors = state.cursors || [];
      const ydoc = this._sharedModel.ydoc || this._sharedModel._ydoc;

      for (const cursor of cursors) {
        if (!cursor?.head || !ydoc) {
          continue;
        }

        try {
          const head = createAbsolutePositionFromRelativePosition(
            cursor.head,
            ydoc
          );
          if (!head) {
            continue;
          }

          const cellId = ytextToCellId.get(head.type);
          if (cellId) {
            cellsForUser.add(cellId);
          }
        } catch (error) {
          continue;
        }
      }

      currentUserCellLocations.set(clientId, cellsForUser);
    });

    // Compare with last known locations
    let hasChanges = false;

    // Check if any users have new/different cell locations
    for (const [clientId, currentCells] of currentUserCellLocations) {
      const lastCells = this._lastUserCellLocations.get(clientId) || new Set();

      if (
        currentCells.size !== lastCells.size ||
        [...currentCells].some(cellId => !lastCells.has(cellId)) ||
        [...lastCells].some(cellId => !currentCells.has(cellId))
      ) {
        hasChanges = true;
        break;
      }
    }

    // Check if any users have left (no longer in awareness)
    if (!hasChanges) {
      for (const clientId of this._lastUserCellLocations.keys()) {
        if (!currentUserCellLocations.has(clientId)) {
          hasChanges = true;
          break;
        }
      }
    }

    // Update tracking
    this._lastUserCellLocations = currentUserCellLocations;

    return hasChanges;
  }

  /**
   * Update the internal collaborator list from awareness state
   */
  private _updateCellCollaborators(): void {
    if (!this._awareness || !this._panel?.content?.widgets) {
      return;
    }

    // Clear previous collaborator data
    this._collaboratorsByCellId.clear();

    const awarenessStates = this._awareness.getStates();

    // Build map of cell ytext to cell ID for efficient lookup
    const ytextToCellId = new Map<any, string>();

    this._panel.content.widgets.forEach((cell: any, index: number) => {
      if (cell.model && cell.model.sharedModel) {
        const ytext =
          cell.model.sharedModel.ysource || cell.model.sharedModel.ytext;
        if (ytext) {
          const cellId = cell.model.id || `cell-${index}`;
          ytextToCellId.set(ytext, cellId);
        }
      }
    });

    awarenessStates.forEach((state: IAwarenessState, clientId: number) => {
      // Skip our own client
      if (clientId === this._awareness!.clientID) {
        return;
      }

      const user = state.user || {};
      const name = user.name || user.display_name;
      if (!name) {
        return;
      }

      const email = user.email || '';
      const avatar_url = user.avatar_url || user.avatarUrl || '';
      let color = user.color;

      if (!color) {
        color = generateUserColor(name);
      }

      const initials = generateInitials(name);

      const collaborator: ICellCollaborator = {
        name,
        initials,
        email,
        avatar_url,
        color,
        clientId
      };

      // Check which cells this collaborator is active in
      const cursors = state.cursors || [];
      const ydoc = this._sharedModel.ydoc || this._sharedModel._ydoc;

      for (const cursor of cursors) {
        if (!cursor?.head || !ydoc) {
          continue;
        }

        try {
          const head = createAbsolutePositionFromRelativePosition(
            cursor.head,
            ydoc
          );
          if (!head) {
            continue;
          }

          // Find which cell this cursor belongs to
          const cellId = ytextToCellId.get(head.type);
          if (cellId) {
            if (!this._collaboratorsByCellId.has(cellId)) {
              this._collaboratorsByCellId.set(cellId, new Map());
            }
            this._collaboratorsByCellId
              .get(cellId)!
              .set(clientId, collaborator);
          }
        } catch (error) {
          // Skip cursors that can't be resolved
          continue;
        }
      }
    });
  }

  /**
   * Render collaborator indicators in the appropriate cells
   */
  private _renderCellIndicators(): void {
    if (!this._panel?.content?.widgets) {
      return;
    }

    // Update cell element map
    this._updateCellElementMap();

    // Clear existing indicators
    this._indicatorElements.forEach(indicator => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    });
    this._indicatorElements.clear();

    // Create indicators for cells with collaborators
    this._collaboratorsByCellId.forEach((collaborators, cellId) => {
      const cellElement = this._cellElements.get(cellId);
      if (!cellElement || collaborators.size === 0) {
        return;
      }

      const indicator = this._createCellIndicator(
        Array.from(collaborators.values())
      );
      this._positionIndicator(indicator, cellElement);
      this._indicatorElements.set(cellId, indicator);
    });
  }

  /**
   * Update the mapping of cell IDs to DOM elements
   */
  private _updateCellElementMap(): void {
    this._cellElements.clear();

    if (!this._panel?.content?.widgets) {
      return;
    }

    this._panel.content.widgets.forEach((cell: any, index: number) => {
      const cellId = cell.model?.id || `cell-${index}`;
      if (cell.node) {
        this._cellElements.set(cellId, cell.node);
      }
    });
  }

  /**
   * Create a collaborator indicator element for a cell
   */
  private _createCellIndicator(
    collaborators: ICellCollaborator[]
  ): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'jp-CellAwareness-indicator';

    const maxVisible = 3;
    const visibleCollaborators = collaborators.slice(0, maxVisible);
    const remainingCount = Math.max(0, collaborators.length - maxVisible);

    // Create overlapping avatars
    visibleCollaborators.forEach((collaborator, index) => {
      const avatar = this._createAvatarElement(collaborator, index);
      indicator.appendChild(avatar);
    });

    // Add overflow indicator if needed
    if (remainingCount > 0) {
      const overflow = document.createElement('div');
      overflow.className = 'jp-CellAwareness-avatar jp-CellAwareness-overflow';
      overflow.style.setProperty(
        '--avatar-index',
        visibleCollaborators.length.toString()
      );
      overflow.textContent = `+${remainingCount}`;

      // Add tooltip for overflow indicator
      overflow.title = `${remainingCount} more collaborator${remainingCount > 1 ? 's' : ''}`;

      indicator.appendChild(overflow);
    }

    // Enable pointer events for hover functionality
    indicator.style.pointerEvents = 'auto';

    return indicator;
  }

  /**
   * Create an avatar element for a collaborator
   */
  private _createAvatarElement(
    collaborator: ICellCollaborator,
    index: number
  ): HTMLElement {
    const avatar = document.createElement('div');
    avatar.className = 'jp-CellAwareness-avatar';
    avatar.style.setProperty('--avatar-index', index.toString());
    avatar.style.setProperty('--avatar-color', collaborator.color);

    if (collaborator.avatar_url) {
      const img = document.createElement('img');
      img.className = 'jp-CellAwareness-avatar-image';
      img.src = collaborator.avatar_url;
      img.alt = `${collaborator.name} avatar`;

      img.addEventListener('error', () => {
        avatar.removeChild(img);
        avatar.textContent = collaborator.initials;
        avatar.classList.add('jp-CellAwareness-avatar-initials');
      });

      avatar.appendChild(img);
    } else {
      avatar.textContent = collaborator.initials;
      avatar.classList.add('jp-CellAwareness-avatar-initials');
    }

    // Add hover effects for modal display
    avatar.addEventListener('mouseenter', event => {
      this._showCollaboratorModal(collaborator, event.target as HTMLElement);
    });

    avatar.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });

    return avatar;
  }

  /**
   * Position an indicator in the bottom-right corner of a cell
   */
  private _positionIndicator(
    indicator: HTMLElement,
    cellElement: HTMLElement
  ): void {
    indicator.style.position = 'absolute';
    indicator.style.right = '8px';
    indicator.style.bottom = '8px';
    indicator.style.zIndex = '1000';

    // Ensure the cell has relative positioning
    const cellStyle = window.getComputedStyle(cellElement);
    if (cellStyle.position === 'static') {
      cellElement.style.position = 'relative';
    }

    cellElement.appendChild(indicator);
  }

  /**
   * Show a modal with detailed collaborator information.
   *
   * @param collaborator - The collaborator data
   * @param targetElement - The element to position the modal relative to
   */
  private _showCollaboratorModal(
    collaborator: ICellCollaborator,
    targetElement: HTMLElement
  ): void {
    this._clearHideModalTimeout();
    this._hideCurrentModal();

    const modal = document.createElement('div');
    modal.className = 'jp-DocumentCollaborators-modal';

    // Create modal content
    const content = document.createElement('div');
    content.className = 'jp-DocumentCollaborators-modal-content';

    // Create header with user icon and info
    const headerElement = document.createElement('div');
    headerElement.className = 'jp-DocumentCollaborators-modal-header';

    // User icon
    const userIconElement = document.createElement('div');
    userIconElement.className = 'jp-DocumentCollaborators-modal-userIcon';

    if (collaborator.avatar_url) {
      // Use avatar image
      userIconElement.classList.add(
        'jp-DocumentCollaborators-modal-userIcon-avatar'
      );
      const avatarImage = document.createElement('img');
      avatarImage.className = 'jp-DocumentCollaborators-modal-avatar';
      avatarImage.src = collaborator.avatar_url;
      avatarImage.alt = `${collaborator.name} avatar`;

      // Handle image load errors by falling back to initials
      avatarImage.addEventListener('error', () => {
        userIconElement.removeChild(avatarImage);
        userIconElement.classList.remove(
          'jp-DocumentCollaborators-modal-userIcon-avatar'
        );
        userIconElement.style.backgroundColor = collaborator.color;

        const initialsElement = document.createElement('div');
        initialsElement.className = 'jp-DocumentCollaborators-modal-initials';
        initialsElement.textContent = collaborator.initials;
        userIconElement.appendChild(initialsElement);
      });

      userIconElement.appendChild(avatarImage);
    } else {
      // Fall back to initials
      userIconElement.style.backgroundColor = collaborator.color;

      const initialsElement = document.createElement('div');
      initialsElement.className = 'jp-DocumentCollaborators-modal-initials';
      initialsElement.textContent = collaborator.initials;
      userIconElement.appendChild(initialsElement);
    }

    headerElement.appendChild(userIconElement);

    // User info container
    const userInfoElement = document.createElement('div');
    userInfoElement.className = 'jp-DocumentCollaborators-modal-userInfo';

    // User name
    const nameElement = document.createElement('div');
    nameElement.className = 'jp-DocumentCollaborators-modal-name';
    nameElement.textContent = collaborator.name;
    userInfoElement.appendChild(nameElement);

    // User email (if available)
    if (collaborator.email) {
      const emailElement = document.createElement('div');
      emailElement.className = 'jp-DocumentCollaborators-modal-email';
      emailElement.textContent = collaborator.email;
      userInfoElement.appendChild(emailElement);
    }

    headerElement.appendChild(userInfoElement);
    content.appendChild(headerElement);

    modal.appendChild(content);

    // Add hover handlers to keep modal visible
    modal.addEventListener('mouseenter', () => {
      this._clearHideModalTimeout();
    });

    modal.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });

    // Position and show modal
    this._positionAndShowModal(modal, targetElement);
  }

  /**
   * Position and display a modal relative to a target element.
   *
   * @param modal - The modal element to show
   * @param targetElement - The element to position the modal relative to
   */
  private _positionAndShowModal(
    modal: HTMLDivElement,
    targetElement: HTMLElement
  ): void {
    // Add modal to document body
    document.body.appendChild(modal);
    this._currentModal = modal;

    // Get target element position
    const targetRect = targetElement.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    // Position modal above the target element
    let left = targetRect.left + targetRect.width / 2 - modalRect.width / 2;
    let top = targetRect.top - modalRect.height - 8; // 8px gap

    // Ensure modal stays within viewport
    const padding = 8;
    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - modalRect.width - padding)
    );

    // If modal would be cut off at the top, show it below the target
    if (top < padding) {
      top = targetRect.bottom + 8;
    }

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;

    // Trigger animation
    requestAnimationFrame(() => {
      modal.classList.add('jp-DocumentCollaborators-modal-visible');
    });
  }

  /**
   * Schedule hiding the current modal after a delay.
   */
  private _scheduleHideModal(): void {
    this._clearHideModalTimeout();
    this._hideModalTimeout = setTimeout(() => {
      this._hideCurrentModal();
    }, 200); // Small delay to allow moving to modal
  }

  /**
   * Clear any scheduled modal hide timeout.
   */
  private _clearHideModalTimeout(): void {
    if (this._hideModalTimeout) {
      clearTimeout(this._hideModalTimeout);
      this._hideModalTimeout = null;
    }
  }

  /**
   * Hide the currently displayed modal.
   */
  private _hideCurrentModal(): void {
    if (this._currentModal) {
      this._currentModal.classList.remove(
        'jp-DocumentCollaborators-modal-visible'
      );
      setTimeout(() => {
        if (this._currentModal && this._currentModal.parentNode) {
          this._currentModal.parentNode.removeChild(this._currentModal);
        }
        this._currentModal = null;
      }, 200); // Match CSS transition duration
    }
  }

  /**
   * Dispose of the widget resources
   */
  dispose(): void {
    if (this._awareness) {
      this._awareness.off('change', this._onAwarenessChange.bind(this));
    }

    // Clean up modal
    this._clearHideModalTimeout();
    this._hideCurrentModal();

    // Clean up indicators
    this._indicatorElements.forEach(indicator => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    });
    this._indicatorElements.clear();
    this._cellElements.clear();
    this._collaboratorsByCellId.clear();
    this._lastUserCellLocations.clear();

    super.dispose();
  }
}

/**
 * Document registry extension for adding cell awareness indicators
 */
class CellAwarenessExtension
  implements DocumentRegistry.IWidgetExtension<any, any>
{
  /**
   * Create a new extension instance for a document widget
   */
  createNew(panel: any, context: DocumentRegistry.IContext<any>): IDisposable {
    const cellAwarenessWidget = new CellAwarenessWidget(panel, context);

    return {
      dispose: (): void => {
        cellAwarenessWidget.dispose();
      },
      isDisposed: false
    };
  }
}

/**
 * JupyterLab plugin for cell awareness indicators
 */
const cellAwarenessPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-document-collaborators:cell-awareness',
  description:
    'A JupyterLab extension for showing collaborator presence in notebook cells',
  autoStart: true,
  requires: [IDocumentManager],
  activate: (app: JupyterFrontEnd, docManager: IDocumentManager) => {
    console.log('Cell awareness extension is activated!');

    const extension = new CellAwarenessExtension();
    app.docRegistry.addWidgetExtension('Notebook', extension);
  }
};

export default cellAwarenessPlugin;

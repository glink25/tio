import {
  ComponentsContext,
  LinkToolbarController,
  useBlockNoteEditor,
  useEditorState,
  useComponentsContext,
  useDictionary,
  SideMenu,
  DragHandleMenu,
  RemoveBlockItem,
  BlockColorsItem,
  TableRowHeaderItem,
  TableColumnHeaderItem,
  type ComponentProps,
} from '@blocknote/react';
import { ShadCNDefaultComponents } from '@blocknote/shadcn';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { forwardRef, type ReactElement, type MouseEventHandler } from 'react';

import { useEditorMotion } from './motion';

// These upstream leaf renderers use React 19's ref-as-prop convention.
// Call them inside forwardRef so React 18 passes the ref through to Base UI.
function bridge<P extends object>(render: (props: P) => ReactElement) {
  const Component = forwardRef<HTMLElement, Omit<P, 'ref'>>((props, ref) =>
    render({ ...props, ref } as unknown as P),
  );
  Component.displayName = `Editor${render.name}`;
  return Component as unknown as typeof render;
}
const defaults = ShadCNDefaultComponents;
// Formatting commands restore the caret themselves. A closing Base UI popup
// must not subsequently move focus back to its trigger and clear a new range.
function preserveEditorFocus() {
  return !document.activeElement?.closest('.bn-editor');
}
export const shadCNComponents = {
  Button: { Button: bridge(defaults.Button.Button) },
  Toggle: { Toggle: bridge(defaults.Toggle.Toggle) },
  Input: { Input: bridge(defaults.Input.Input) },
  Label: { Label: bridge(defaults.Label.Label) },
  DropdownMenu: {
    ...defaults.DropdownMenu,
    DropdownMenuTrigger: bridge(defaults.DropdownMenu.DropdownMenuTrigger),
    DropdownMenuContent: bridge(
      (props: Parameters<typeof defaults.DropdownMenu.DropdownMenuContent>[0]) =>
        defaults.DropdownMenu.DropdownMenuContent({
          ...props,
          finalFocus: props.finalFocus ?? preserveEditorFocus,
        }),
    ),
    DropdownMenuSubContent: bridge(
      (props: Parameters<typeof defaults.DropdownMenu.DropdownMenuSubContent>[0]) =>
        defaults.DropdownMenu.DropdownMenuSubContent({
          ...props,
          finalFocus: props.finalFocus ?? preserveEditorFocus,
        }),
    ),
    DropdownMenuSubTrigger: bridge(defaults.DropdownMenu.DropdownMenuSubTrigger),
    DropdownMenuItem: bridge(defaults.DropdownMenu.DropdownMenuItem),
    DropdownMenuCheckboxItem: bridge(defaults.DropdownMenu.DropdownMenuCheckboxItem),
    DropdownMenuLabel: bridge(defaults.DropdownMenu.DropdownMenuLabel),
    DropdownMenuSeparator: bridge(defaults.DropdownMenu.DropdownMenuSeparator),
  },
  Popover: {
    ...defaults.Popover,
    PopoverTrigger: bridge(defaults.Popover.PopoverTrigger),
    PopoverContent: bridge((props: Parameters<typeof defaults.Popover.PopoverContent>[0]) =>
      defaults.Popover.PopoverContent({
        ...props,
        finalFocus: props.finalFocus ?? preserveEditorFocus,
      }),
    ),
  },
  Select: {
    ...defaults.Select,
    SelectTrigger: bridge(defaults.Select.SelectTrigger),
    SelectContent: bridge((props: Parameters<typeof defaults.Select.SelectContent>[0]) =>
      defaults.Select.SelectContent({
        ...props,
        finalFocus: props.finalFocus ?? preserveEditorFocus,
      }),
    ),
    SelectItem: bridge(defaults.Select.SelectItem),
  },
  Tooltip: {
    ...defaults.Tooltip,
    TooltipTrigger: bridge(defaults.Tooltip.TooltipTrigger),
    TooltipContent: bridge(defaults.Tooltip.TooltipContent),
  },
};

const SideButton = forwardRef<HTMLButtonElement, ComponentProps['SideMenu']['Button']>(
  ({ icon, label, children, className, draggable, onClick, ...props }, ref) => {
    // The default AddBlockButton attaches its action to the icon. Move that
    // action onto the button so its whole hit area works, including touch.
    const add = icon as ReactElement<{ onClick?: MouseEventHandler<HTMLButtonElement> }>;
    const Button = shadCNComponents.Button.Button;
    return (
      <Button
        {...props}
        ref={ref}
        draggable={draggable}
        aria-label={label}
        variant="ghost"
        className={`${className ?? ''} tio-block-action`}
        onClick={onClick ?? (!draggable ? add?.props.onClick : undefined)}
      >
        {draggable ? (
          <GripVertical size={16} strokeWidth={1.5} />
        ) : (
          <Plus size={16} strokeWidth={1.5} />
        )}
        {children}
      </Button>
    );
  },
);
SideButton.displayName = 'EditorSideButton';

function DeleteBlockItem() {
  const components = useComponentsContext()!;
  const dictionary = useDictionary();
  const Item = components.Generic.Menu.Item;
  return (
    <ComponentsContext.Provider
      value={{
        ...components,
        Generic: {
          ...components.Generic,
          Menu: {
            ...components.Generic.Menu,
            Item: (props) => (
              <Item {...props} className={`${props.className ?? ''} tio-block-delete`} />
            ),
          },
        },
      }}
    >
      <RemoveBlockItem>
        <Trash2 size={16} strokeWidth={1.5} />
        {dictionary.drag_handle.delete_menuitem}
      </RemoveBlockItem>
    </ComponentsContext.Provider>
  );
}
function BlockMenu() {
  const dictionary = useDictionary();
  return (
    <DragHandleMenu>
      <DeleteBlockItem />
      <BlockColorsItem>{dictionary.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dictionary.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dictionary.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}
export function EditorSideMenu() {
  const components = useComponentsContext()!;
  return (
    <ComponentsContext.Provider
      value={{ ...components, SideMenu: { ...components.SideMenu, Button: SideButton } }}
    >
      <SideMenu dragHandleMenu={BlockMenu} />
    </ComponentsContext.Provider>
  );
}

// A non-empty link selection belongs to the formatting toolbar. The default
// hover/caret link toolbar otherwise occupies the same anchor and covers it.
export function EditorLinkToolbar() {
  const floatingMotion = useEditorMotion();
  const editor = useBlockNoteEditor();
  const collapsed = useEditorState({
    editor,
    selector: ({ editor }) => editor.prosemirrorState.selection.empty,
  });
  return collapsed ? <LinkToolbarController floatingUIOptions={floatingMotion} /> : null;
}

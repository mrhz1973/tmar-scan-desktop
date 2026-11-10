<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mesh Tools local notes and Zebra

**Web implementation; user review OPEN.** Mesh Tools now has the same **Note**
button/shortcut, shared note list, Ctrl/Cmd/Shift multi-selection, local editor,
Go to note/highlight, collapse and project storage as Reverse engineer. No agent
connection is required. Existing notes are reused, not copied into a second list.

The lower **Zebra** key inspects the displayed scan, an edited copy or a reduced
mesh. The Analyze field identifies the actual target. Stripe direction, width
and color use the existing Zebra panel and shader. Reduced flat-shaded meshes
without normals get an owned display-only copy with per-triangle normals; neither
source positions/indices nor the source material or exported geometry are changed.
Disabling the layer releases its resources and restores the current view.

**Zebra is reflected-stripe inspection, not numerical deviation.** Numerical
Accuracy/Deviation settings and values remain intact; switch Zebra off to read
the color map. STEP scan boundaries can also be displayed using CAD edges where
original face metadata remains available. Mesh-only files and edited/reduced
copies do not acquire invented CAD topology.

## Notes and interaction boundaries

New notes in Mesh Tools attach to the **scan in use**. On a reduced preview,
return to Scan to annotate. An uncommitted edited copy can be inspected with
Zebra, but cannot silently receive a note labeled as an original-scan anchor:
use Reverse engineer to annotate the original, or explicitly adopt the edited
copy with **Use for analysis** when that is the intended operation. No adoption
or discarding occurs merely by enabling notes or Zebra. Navigation to an existing
note during a preview shows its saved coordinates with a warning.

Close an active mesh edit tool before inspection/placement. This avoids stealing
a click meant to fill a hole, mark a deletion, pick a Boolean body or adjust a cut.
Pending operations and markings are not automatically accepted or discarded.
Split-view annotations and arbitrary preview-target note serialization remain
separate work. The same local-note and imported-provenance rules are preserved.

## Source

This optional plugin requires `mesh-tools`, `reverse`, `tmar-quick-notes` and
`tmar-zebra`. It installs `mesh.analysis`, `mesh.notes` and `view.tools` entries,
plus the existing note-workspace adapter. The host does not import the plugin by
name. No dependency, kernel or file-source change is made by inspection.

[Validation and bounded test results](../../docs/tmar-mesh-review-validation.md)
| [Smooth intensity and retained selection](../tmar-smooth-controls/README.md).

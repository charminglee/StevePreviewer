/* global Action, Animation, Blockbench, Canvas, Codecs, Cube, Dialog, Format,
   Group, ModelProject, Modes, Outliner, OutlinerElement, OutlinerNode, Plugin,
   Project, Texture, Timeline, Toolbars, Undo, updateSelection */

(() => {
    "use strict";

    const ID = "steve_previewer";
    // 沿用已保存工程和撤销记录中的状态键，改名后仍能识别原预览数据
    const STATE_KEY = "modeling_based_on_steve";
    const STEVE = /* @embedded-steve-geometry */ null;
    const SKIN = /* @embedded-steve-texture */ "";
    const listeners = [];
    const dialogs = new Set();
    const patchedFaces = new WeakMap();
    let action;
    let css;
    let skin;
    let originalCompile;
    let wrappedCompile;

    const clone = value => JSON.parse(JSON.stringify(value));
    const supported = () => Project && Format.id === "bedrock";
    const state = () => Project.unhandled_root_fields[STATE_KEY] || {};
    const activeGroups = () => (state().groups || [])
        .map(uuid => OutlinerNode.uuids[uuid]).filter(node => node instanceof Group);
    const activeCubes = () => (state().cubes || [])
        .map(uuid => OutlinerNode.uuids[uuid]).filter(node => node instanceof Cube);
    const enabled = () => supported() && (activeGroups().length > 0 || activeCubes().length > 0);

    function listen(target, event, callback) {
        target.on(event, callback);
        listeners.push({target, event, callback});
    }

    function getSkin() {
        if (!skin) {
            // 不加入 Texture.all，避免成为基岩版单贴图项目的默认贴图
            skin = new Texture({name: "Steve (plugin preview)", keep_size: true});
            skin.getUVWidth = () => 64;
            skin.getUVHeight = () => 64;
            skin.fromDataURL(SKIN);
        }
        return skin;
    }

    function isPreviewCube(cube) {
        return supported() && (state().cubes || []).includes(cube.uuid);
    }

    function updateSteveFaces({element}) {
        if (isPreviewCube(element) && ["textured", "material"].includes(Project.view_mode)) {
            element.mesh.material = getSkin().getMaterial();
        }
    }

    function updateSteveUV({element}) {
        if (!isPreviewCube(element)) return;
        const attribute = element.mesh.geometry.attributes.uv;
        // 宿主先计算 box UV；仅重写 Steve 的 GPU UV，项目 UV 尺寸和其他模型保持原值
        Canvas.face_order.forEach((key, index) => {
            const face = element.faces[key];
            if (face.texture === null) return;
            const uv = face.uv.slice();
            if (element.box_uv) {
                for (let axis = 0; axis < 2; axis++) {
                    const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64;
                    uv[axis] += margin;
                    uv[axis + 2] -= margin;
                }
            }
            const corners = [
                [uv[0] / 64, 1 - uv[1] / 64],
                [uv[2] / 64, 1 - uv[1] / 64],
                [uv[0] / 64, 1 - uv[3] / 64],
                [uv[2] / 64, 1 - uv[3] / 64]
            ];
            for (let angle = face.rotation; angle > 0; angle -= 90) {
                const first = corners[0];
                corners[0] = corners[2];
                corners[2] = corners[3];
                corners[3] = corners[1];
                corners[1] = first;
            }
            corners.forEach((corner, vertex) => attribute.array.set(corner, index * 8 + vertex * 2));
        });
        attribute.needsUpdate = true;
    }

    function refresh() {
        const value = enabled();
        action.nodes.forEach(node => {
            node.classList.toggle("enabled", value);
            node.setAttribute("aria-pressed", value ? "true" : "false");
        });
        if (!supported()) return;
        activeCubes().forEach(cube => {
            Object.values(cube.faces).forEach(face => {
                if (!patchedFaces.has(face)) patchedFaces.set(face, Object.getOwnPropertyDescriptor(face, "getTexture"));
                face.getTexture = getSkin;
            });
            cube.preview_controller.updateFaces(cube);
            cube.preview_controller.updateUV(cube);
        });
        document.querySelectorAll(".outliner_object.mbs_preview").forEach(node => node.classList.remove("mbs_preview"));
        activeGroups().concat(activeCubes()).forEach(node => {
            const row = document.getElementById(node.uuid)?.querySelector(".outliner_object");
            if (row) row.classList.add("mbs_preview");
        });
    }

    function transaction(label, callback) {
        // 跟踪全部组，避免父子层级变动后宿主遗漏组数据；动画也纳入同一次撤销
        const aspects = {
            elements: Outliner.elements.slice(), groups: Group.all.slice(),
            outliner: true, animations: Animation.all.slice(), selection: true,
            [STATE_KEY]: true
        };
        Undo.initEdit(aspects);
        try {
            callback();
            Canvas.updateAll();
            updateSelection();
            Undo.finishEdit(label, Object.assign({}, aspects, {
                elements: Outliner.elements.slice(), groups: Group.all.slice()
            }));
        } catch (error) {
            aspects.elements = Outliner.elements.slice();
            aspects.groups = Group.all.slice();
            Undo.cancelEdit(true);
            Blockbench.showMessageBox({title: "Steve 预览操作失败", message: error.message});
        }
        refresh();
    }

    function showDialog(options) {
        const dialog = new Dialog(options);
        dialogs.add(dialog);
        dialog.show();
        return dialog;
    }

    function checkNames(names, onReady) {
        const existing = new Set(Group.all.map(group => group.name.toLowerCase()));
        const conflicts = names.filter(name => existing.has(name.toLowerCase()));
        if (!conflicts.length) {
            onReady("");
            return;
        }
        // 同名骨骼不能在 Bedrock 动画中区分，名称变更交由用户选择
        const project = Project;
        const dialog = showDialog({
            id: ID + "_names", title: "Steve 骨骼名称冲突",
            lines: ["已有同名骨骼：" + conflicts.join(", "), "请选择 Steve 骨骼的统一前缀，现有骨骼不会被改名。"],
            form: {prefix: {label: "Steve 骨骼前缀", type: "text", value: "steve_"}},
            buttons: ["使用前缀", "取消"],
            onConfirm(result) {
                if (Project !== project) {
                    this.hide(); this.delete(); dialogs.delete(dialog);
                    return false;
                }
                const prefix = result.prefix;
                if (!/^[a-zA-Z0-9_]+$/.test(prefix) ||
                    names.some(name => existing.has((prefix + name).toLowerCase()))) {
                    Blockbench.showQuickMessage("请输入不产生同名骨骼的字母、数字或下划线前缀");
                    return false;
                }
                this.hide();
                this.delete();
                dialogs.delete(dialog);
                onReady(prefix);
                return false;
            },
            onCancel() {
                this.hide(); this.delete(); dialogs.delete(dialog);
                return false;
            }
        });
    }

    function snapshot() {
        const groups = activeGroups();
        const cubes = activeCubes();
        const parents = {};
        groups.concat(cubes).forEach(node => {
            parents[node.uuid] = node.parent === "root" ? null : node.parent.uuid;
        });
        return {
            groups: groups.map(group => clone(group.getSaveCopy(false))),
            cubes: cubes.map(cube => cube.getUndoCopy()), parents
        };
    }

    function createSteve(prefix) {
        const groups = {};
        const ids = {groups: [], cubes: []};
        STEVE.bones.forEach(bone => {
            const origin = bone.pivot.slice();
            origin[0] *= -1;
            const group = new Group({name: prefix + bone.name, origin, export: false}).init();
            groups[bone.name] = group;
            ids.groups.push(group.uuid);
        });
        // 官方数据不保证父骨骼在前，因此先建立所有骨骼再连接层级
        STEVE.bones.forEach(bone => {
            const group = groups[bone.name];
            group.addTo(bone.parent ? groups[bone.parent] : "root");
            (bone.cubes || []).forEach(data => {
                const cube = Codecs.bedrock.parseCube(data, group, bone);
                cube.name = prefix + bone.name + "_preview";
                cube.export = false;
                ids.cubes.push(cube.uuid);
            });
        });
        Project.unhandled_root_fields[STATE_KEY] = ids;
    }

    function restoreSteve(cache, prefix) {
        const all = cache.groups.concat(cache.cubes);
        if (all.some(data => OutlinerNode.uuids[data.uuid])) {
            throw new Error("暂存的 Steve UUID 与当前对象冲突，请先撤销相关合并操作。");
        }
        cache.groups.forEach(data => {
            new Group(Object.assign({}, data, {name: prefix + data.name}), data.uuid).init();
        });
        cache.cubes.forEach(data => OutlinerElement.fromSave(clone(data), true));
        all.forEach(data => {
            const parent = OutlinerNode.uuids[cache.parents[data.uuid]];
            OutlinerNode.uuids[data.uuid].addTo(parent instanceof Group ? parent : "root");
        });
        Project.unhandled_root_fields[STATE_KEY] = {
            groups: cache.groups.map(data => data.uuid), cubes: cache.cubes.map(data => data.uuid)
        };
        // UUID 不变即可重新接上暂存前的动画；同步名称供关闭状态下的导出使用
        Animation.all.forEach(animation => {
            cache.groups.forEach(data => {
                const animator = animation.animators[data.uuid];
                if (animator) animator.name = prefix + data.name;
            });
        });
    }

    function enablePreview() {
        const cache = state().cache;
        const names = cache ? cache.groups.map(data => data.name) : STEVE.bones.map(bone => bone.name);
        checkNames(names, prefix => transaction("开启 Steve 预览", () => {
            getSkin();
            if (cache) restoreSteve(cache, prefix);
            else createSteve(prefix);
        }));
    }

    function disablePreview(moveAttachments) {
        transaction("关闭 Steve 预览", () => {
            const groups = activeGroups();
            const cubes = activeCubes();
            const groupIds = new Set(groups.map(group => group.uuid));
            const cubeIds = new Set(cubes.map(cube => cube.uuid));
            const attachments = Group.all.concat(Outliner.elements).filter(node =>
                groupIds.has(node.parent.uuid) && !groupIds.has(node.uuid) && !cubeIds.has(node.uuid));
            const cache = snapshot();
            if (moveAttachments) attachments.forEach(node => node.addTo("root"));

            // Group.remove 会连带删除动画，先摘出 Steve 轨道，再在移除骨骼后放回
            const tracks = [];
            Animation.all.forEach(animation => {
                groups.forEach(group => {
                    const animator = animation.animators[group.uuid];
                    if (!animator) return;
                    animator.name = group.name;
                    tracks.push({animation, uuid: group.uuid, animator});
                    delete animation.animators[group.uuid];
                    const index = Timeline.animators.indexOf(animator);
                    if (index !== -1) Timeline.animators.splice(index, 1);
                    if (Timeline.selected_animator === animator) Timeline.selected_animator = null;
                });
            });
            groups.forEach(group => {
                if (Group.all.includes(group)) group.remove(false);
            });
            cubes.forEach(cube => {
                if (Outliner.elements.includes(cube)) cube.remove();
            });
            tracks.forEach(({animation, uuid, animator}) => { animation.animators[uuid] = animator; });
            Project.unhandled_root_fields[STATE_KEY] = {cache};
        });
    }

    function togglePreview() {
        if (!enabled()) { enablePreview(); return; }
        const owned = new Set(activeGroups().concat(activeCubes()).map(node => node.uuid));
        const attachments = Group.all.concat(Outliner.elements).filter(node =>
            owned.has(node.parent.uuid) && !owned.has(node.uuid));
        if (!attachments.length) { disablePreview(true); return; }
        const project = Project;
        const dialog = showDialog({
            id: ID + "_attachments", title: "处理 Steve 下的自建模型",
            lines: ["Steve 骨骼下有自建内容：" + attachments.map(node => node.name).join(", "),
                "移至顶层保留对象坐标和局部旋转；删除会移除这些内容及其子级。Steve 动画轨道始终保留。"],
            buttons: ["移至顶层", "删除"],
            confirmIndex: 0, cancelIndex: -1,
            onButton(index) {
                if (index !== 0 && index !== 1) return false;
                this.hide();
                this.delete();
                dialogs.delete(dialog);
                if (Project === project && supported() && enabled()) disablePreview(index === 0);
                return false;
            }
        });
    }

    function filterGeometry({model, options}) {
        if (!supported() || !enabled()) return;
        const groups = activeGroups();
        const names = new Set(groups.map(group => group.name));
        model["minecraft:geometry"].forEach(geometry => {
            const required = new Set();
            // 以本次实际编译的内容为依据，兼容只导出选中内容的情况
            (geometry.bones || []).forEach(bone => {
                const hasContent = ["cubes", "locators", "poly_mesh", "texture_meshes"].some(key =>
                    bone[key] && Object.keys(bone[key]).length > 0);
                if (names.has(bone.name) && !hasContent) return;
                const group = Group.all.find(node => node.name === bone.name);
                for (let parent = group; parent instanceof Group; parent = parent.parent) {
                    if (names.has(parent.name)) required.add(parent.name);
                }
            });
            geometry.bones = (geometry.bones || []).filter(bone => !names.has(bone.name) || required.has(bone.name));
            const exported = new Set(geometry.bones.map(bone => bone.name));
            groups.forEach(group => {
                if (!required.has(group.name) || exported.has(group.name)) return;
                const bone = {name: group.name, pivot: [-group.origin[0], group.origin[1], group.origin[2]]};
                const offset = options?.offset || Codecs.bedrock.context?.offset;
                if (offset) {
                    bone.pivot[0] += offset[0];
                    bone.pivot[1] -= offset[1];
                    bone.pivot[2] -= offset[2];
                }
                if (group.parent instanceof Group) bone.parent = group.parent.name;
                if (group.rotation.some(value => value !== 0)) {
                    bone.rotation = [-group.rotation[0], -group.rotation[1], group.rotation[2]];
                }
                if (group.bedrock_binding) bone.binding = group.bedrock_binding;
                if (group.reset) bone.reset = true;
                if (group.material) bone.material = group.material;
                geometry.bones.push(bone);
            });
        });
    }

    function compileWithoutSteve(options) {
        if (!enabled()) return originalCompile.call(this, options);
        const cubes = activeCubes();
        const flags = cubes.map(cube => cube.export);
        // 集合导出会临时把选中对象标为可导出，须在原生编译前排除预览块
        cubes.forEach(cube => { cube.export = false; });
        try {
            return originalCompile.call(this, options);
        } finally {
            cubes.forEach((cube, index) => { cube.export = flags[index]; });
        }
    }

    Plugin.register(ID, {
        title: "StevePreviewer", author: "Nuoyan", version: "1.0.0",
        description: "使用基岩原版Steve实体模型或网易版4D标准模型作为开发预览。",
        about: /* @embedded-about */ "",
        icon: "accessibility_new", variant: "desktop", min_version: "5.2.2",
        tags: ["Minecraft: Bedrock Edition", "Utility"],
        onload() {
            action = new Action(ID, {
                name: "预览 Steve 模型", description: "StevePreviewer — 开关原版 Steve 开发预览",
                icon: "accessibility_new", category: "view",
                condition: () => supported() && ["edit", "animate"].includes(Modes.selected.id),
                click: togglePreview
            });
            const toolbar = Toolbars.outliner;
            toolbar.remove(action, false);
            // 放在弹性占位符前，与左侧已有按钮排列在一起
            const spacerIndex = toolbar.children.findIndex(item => typeof item === "string" && item.startsWith("+"));
            toolbar.add(action, spacerIndex === -1 ? toolbar.children.length : spacerIndex);
            css = Blockbench.addCSS(`
                .outliner_object.mbs_preview { border-left: 2px dashed #58c9df; background-color: #58c9df0b; }
                .outliner_object.mbs_preview > .icon { color: #58c9df !important; }
                .outliner_object.mbs_preview::after { content: 'STEVE · 预览'; font-size: 9px; color: #58c9df; pointer-events: none; white-space: nowrap; margin: 0 4px; }
            `);
            listen(Cube.preview_controller, "update_faces", updateSteveFaces);
            listen(Cube.preview_controller, "update_uv", updateSteveUV);
            listen(Codecs.bedrock, "compile", filterGeometry);
            originalCompile = Codecs.bedrock.compile;
            wrappedCompile = compileWithoutSteve;
            Codecs.bedrock.compile = wrappedCompile;
            listen(Codecs.project, "parsed", refresh);
            ["select_project", "undo", "redo", "finished_edit"].forEach(event => listen(Blockbench, event, refresh));
            listen(Blockbench, "get_outliner_node_classes", ({node, classes}) => {
                if (supported() && (state().groups || []).concat(state().cubes || []).includes(node.uuid)) {
                    classes.push("mbs_preview");
                }
            });
            listen(Blockbench, "finish_edit", () => {
                if (!supported()) return;
                activeGroups().concat(activeCubes()).forEach(node => { node.export = false; });
            });
            listen(Blockbench, "create_undo_save", ({save, aspects}) => {
                if (supported() && aspects[STATE_KEY]) save[STATE_KEY] = clone(state());
            });
            listen(Blockbench, "load_undo_save", ({save}) => {
                if (supported() && save[STATE_KEY]) Project.unhandled_root_fields[STATE_KEY] = clone(save[STATE_KEY]);
            });
            refresh();
        },
        onunload() {
            dialogs.forEach(dialog => { dialog.hide(); dialog.delete(); });
            dialogs.clear();
            if (Codecs.bedrock.compile === wrappedCompile) Codecs.bedrock.compile = originalCompile;
            listeners.forEach(({target, event, callback}) => target.removeListener(event, callback));
            listeners.length = 0;
            action.delete();
            css.delete();
            document.querySelectorAll(".outliner_object.mbs_preview").forEach(node => node.classList.remove("mbs_preview"));
            // 项目中的预览节点和暂存资料保留为原生数据，卸载不会丢失用户动画
            ModelProject.all.forEach(project => {
                const data = project.unhandled_root_fields[STATE_KEY];
                if (!data) return;
                project.elements.forEach(element => {
                    Object.values(element.faces || {}).forEach(face => {
                        if (!patchedFaces.has(face)) return;
                        const descriptor = patchedFaces.get(face);
                        if (descriptor) Object.defineProperty(face, "getTexture", descriptor);
                        else delete face.getTexture;
                    });
                });
                (data.cubes || []).forEach(uuid => {
                    const mesh = project.nodes_3d[uuid];
                    if (mesh && skin && mesh.material === skin.material) mesh.material = Canvas.transparentMaterial;
                });
            });
            if (supported()) Canvas.updateAll();
            if (skin) {
                skin.img.onload = null;
                skin.img.onerror = null;
                skin.material.map.dispose();
                skin.material.dispose();
                skin = null;
            }
        }
    });
})();

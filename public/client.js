document.addEventListener("DOMContentLoaded", () => {
  // --- INITIALIZATION ---
  const socket = io();
  const canvas = new fabric.Canvas("canvas", {
    backgroundColor: "#222",
    preserveObjectStacking: true,
  });

  // --- STATE MANAGEMENT ---
  let currentImage = {
    filename: null,
    width: 0,
    height: 0,
  };
  let isDrawingMode = false;
  let firstPoint = null;
  let previewRect = null;
  let currentTool = "select"; // 'select', 'box', 'pan'
  let isPanning = false;
  let lastPanPoint = null;

  // --- DOM ELEMENTS ---
  const galleryContainer = document.getElementById("image-gallery");
  const saveBtn = document.getElementById("saveBtn");
  const clearBtn = document.getElementById("clearBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const fillColorInput = document.getElementById("fillColor");
  const strokeColorInput = document.getElementById("strokeColor");
  const canvasViewport = document.getElementById("canvasViewport");
  const placeholderText = document.getElementById("placeholderText");
  const drawingIndicator = document.getElementById("drawingIndicator");
  const annotationList = document.getElementById("annotation-list");

  // Tool buttons
  const selectToolBtn = document.getElementById("selectTool");
  const boxToolBtn = document.getElementById("boxTool");
  const panToolBtn = document.getElementById("panTool");

  // Zoom controls
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  const zoomFitBtn = document.getElementById("zoomFit");
  const zoomActualBtn = document.getElementById("zoomActual");
  const zoomLevelDisplay = document.getElementById("zoomLevel");
  const statusZoom = document.getElementById("statusZoom");

  // Status elements
  const canvasSizeEl = document.getElementById("canvasSize");
  const objectCountEl = document.getElementById("objectCount");
  const currentImageNameEl = document.getElementById("current-image-name");

  // --- API & SOCKET FUNCTIONS ---

  async function loadImageGallery() {
    try {
      const response = await fetch("/api/images");
      const images = await response.json();
      galleryContainer.innerHTML = "";
      images.forEach((img) => {
        const item = document.createElement("div");
        item.className = "gallery-item";
        item.dataset.filename = img.filename;
        item.innerHTML = `
                    <img src="/api/images/${img.filename}" alt="${img.filename}" loading="lazy">
                    <p>${img.filename}</p>
                `;
        item.addEventListener("click", () => loadCanvasImage(img.filename));
        galleryContainer.appendChild(item);
      });
    } catch (error) {
      console.error("Failed to load image gallery:", error);
      galleryContainer.innerHTML = "<p>Error loading images.</p>";
    }
  }
  // ----------  ZOOM-TO-FIT & CENTER  ----------
  function centerImageActualSize() {
    // simply set 1:1 zoom and center
    if (!currentImage.filename) return;
    canvas.setZoom(1);
    const vp = canvasViewport.getBoundingClientRect();
    canvas.absolutePan({
      x: (currentImage.width - vp.width) / 2,
      y: (currentImage.height - vp.height) / 2,
    });
    updateZoomDisplay(1);
  }

  function zoomToFit() {
    if (!currentImage.filename) return;

    const vp = canvasViewport.getBoundingClientRect();
    const scaleX = vp.width / currentImage.width;
    const scaleY = vp.height / currentImage.height;
    const scale = Math.min(scaleX, scaleY) * 0.95; // 5 % padding

    // center the image
    canvas.setZoom(scale);
    canvas.absolutePan({
      x: (currentImage.width * scale - vp.width) / 2,
      y: (currentImage.height * scale - vp.height) / 2,
    });
    updateZoomDisplay(scale);
  }

  // helper to keep zoom-level labels in sync
  function updateZoomDisplay(zoom) {
    const pct = Math.round(zoom * 100);
    zoomLevelDisplay.textContent = `${pct}%`;
    statusZoom.textContent = `${pct}%`;
  }

  async function loadCanvasImage(filename) {
    if (currentImage.filename === filename) return;

    canvas.clear();
    currentImage = { filename: null, width: 0, height: 0 };
    updateStatus();

    fabric.Image.fromURL(`/api/images/${filename}`, (img) => {
      currentImage.filename = filename;
      currentImage.width = img.width;
      currentImage.height = img.height;

      canvas.setWidth(currentImage.width);
      canvas.setHeight(currentImage.height);

      // Reset viewport transform to default state
      canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
      canvas.setZoom(1);

      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
        originX: "left",
        originY: "top",
      });

      placeholderText.style.display = "none";
      saveBtn.disabled = false;
      clearBtn.disabled = false;

      document.querySelectorAll(".gallery-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.filename === filename);
      });

      socket.emit("request:annotations", filename);

      updateStatus();
      // เรียก function จัดกึ่งกลางแทน zoomToFit
      centerImageActualSize();
      selectToolMode("select"); // Default to select tool on new image
    });
  }

  async function saveAnnotations() {
    if (!currentImage.filename) return;

    const annotations = canvas
      .getObjects()
      .filter((obj) => obj.type === "rect" && !obj.isPreview)
      .map((obj) => ({
        id: obj.id,
        left: obj.left,
        top: obj.top,
        width: obj.width * obj.scaleX,
        height: obj.height * obj.scaleY,
      }));

    try {
      const response = await fetch(
        `/api/annotations/${currentImage.filename}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ annotations, imageData: currentImage }),
        },
      );
      const result = await response.json();
      if (result.success) {
        console.log("Annotations saved successfully.");
        alert("Annotations saved!");
      } else {
        throw new Error(result.error || "Unknown error");
      }
    } catch (error) {
      console.error("Error saving annotations:", error);
      alert(`Error saving annotations: ${error.message}`);
    }
  }

  // --- CANVAS & DRAWING FUNCTIONS ---

  function createRect(options) {
    const rect = new fabric.Rect({
      left: options.left,
      top: options.top,
      width: options.width,
      height: options.height,
      fill: `${fillColorInput.value}80`,
      stroke: strokeColorInput.value,
      strokeWidth: 2,
      id: options.id || Date.now(),
      selectable: currentTool === "select",
      evented: currentTool === "select",
      transparentCorners: false,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#000000",
      cornerStyle: "circle",
      cornerSize: 10,
    });
    canvas.add(rect);
    return rect;
  }

  function updateStatus() {
    const objectCount = canvas
      .getObjects()
      .filter((o) => o.type === "rect" && !o.isPreview).length;
    objectCountEl.textContent = objectCount;
    canvasSizeEl.textContent = currentImage.filename
      ? `${currentImage.width} × ${currentImage.height}`
      : "N/A";
    currentImageNameEl.textContent = currentImage.filename || "No image loaded";
    updateAnnotationList();
  }

  function updateAnnotationList() {
    annotationList.innerHTML = "";
    const objects = canvas
      .getObjects()
      .filter((o) => o.type === "rect" && !o.isPreview);
    if (objects.length === 0) {
      annotationList.innerHTML = "<li>No annotations yet.</li>";
      return;
    }
    objects.forEach((obj) => {
      const li = document.createElement("li");
      li.className = "annotation-list-item";
      li.textContent = `Box #${obj.id}`;
      li.dataset.id = obj.id;
      li.onclick = () => {
        canvas.setActiveObject(obj);
        canvas.renderAll();
      };
      if (canvas.getActiveObject() === obj) {
        li.classList.add("selected");
      }
      annotationList.appendChild(li);
    });
  }

  // --- FIX ---
  // Simplified exitDrawingMode to only clean up state.
  // It no longer changes the tool.
  function exitDrawingMode() {
    isDrawingMode = false;
    firstPoint = null;
    if (previewRect) {
      canvas.remove(previewRect);
      previewRect = null;
    }
    drawingIndicator.classList.remove("active");
  }

  function startDrawingMode() {
    if (currentTool !== "box" || !currentImage.filename) return;
    isDrawingMode = true;
    firstPoint = null;
    drawingIndicator.classList.add("active");
  }

  function selectToolMode(tool) {
    exitDrawingMode(); // Always clear previous drawing state first

    currentTool = tool;
    [selectToolBtn, boxToolBtn, panToolBtn].forEach((btn) =>
      btn.classList.remove("active"),
    );
    document.getElementById(tool + "Tool").classList.add("active");

    canvas.isDrawingMode = false;

    if (tool === "select") {
      canvas.selection = true;
      canvas.defaultCursor = "default";
      canvas.forEachObject((obj) => {
        if (obj.type === "rect") {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    } else if (tool === "pan") {
      canvas.selection = false;
      canvas.defaultCursor = "grab";
    } else if (tool === "box") {
      canvas.selection = false;
      canvas.defaultCursor = "crosshair";
      canvas.forEachObject((obj) => {
        if (obj.type === "rect") {
          obj.selectable = false;
          obj.evented = false;
        }
      });
      startDrawingMode(); // Start the drawing mode correctly
    }
    canvas.renderAll();
  }

  // --- ZOOM & PAN FUNCTIONS ---
  function updateZoom(newZoom) {
    const center = canvas.getCenter();
    canvas.zoomToPoint(new fabric.Point(center.left, center.top), newZoom);
    const percentage = Math.round(newZoom * 100);
    zoomLevelDisplay.textContent = `${percentage}%`;
    statusZoom.textContent = `${percentage}%`;
    canvas.renderAll();
  }

  // --- EVENT LISTENERS ---
  saveBtn.addEventListener("click", saveAnnotations);
  selectToolBtn.addEventListener("click", () => selectToolMode("select"));
  boxToolBtn.addEventListener("click", () => selectToolMode("box"));
  panToolBtn.addEventListener("click", () => selectToolMode("pan"));

  zoomInBtn.addEventListener("click", () => updateZoom(canvas.getZoom() * 1.2));
  zoomOutBtn.addEventListener("click", () =>
    updateZoom(canvas.getZoom() / 1.2),
  );
  zoomFitBtn.addEventListener("click", zoomToFit);
  zoomActualBtn.addEventListener("click", centerImageActualSize);

  // Add these variables to your STATE MANAGEMENT section
  let isSpacebarPressed = false;
  let isSpacebarPanning = false;
  let lastSpacebarPanPoint = null;
  let previousCursor = null;
  let previousTool = null;
  let isCKeyToggled = false;
  let isCKeyPanning = false;
  let lastCKeyPanPoint = null;

  // Enhanced keyboard event handlers
  document.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT") return;

    // Handle 'c' key to toggle drag mode
    if (e.key.toLowerCase() === "c") {
      e.preventDefault();
      
      if (!isCKeyToggled) {
        // Turn on drag mode
        isCKeyToggled = true;
        
        // Store current state
        previousCursor = canvas.defaultCursor;
        previousTool = currentTool;

        // Switch to drag mode
        canvas.defaultCursor = "grab";
        canvas.setCursor("grab");
        canvas.selection = false;

        // Disable object selection temporarily
        canvas.forEachObject((obj) => {
          if (obj.type === "rect") {
            obj.selectable = false;
            obj.evented = false;
          }
        });

        canvas.renderAll();
      } else {
        // Turn off drag mode
        isCKeyToggled = false;
        isCKeyPanning = false;
        lastCKeyPanPoint = null;

        // Restore previous state
        canvas.defaultCursor = previousCursor || "default";
        canvas.setCursor(previousCursor || "default");

        // Restore tool mode
        if (previousTool) {
          selectToolMode(previousTool);
        }

        // Clear stored state
        previousCursor = null;
        previousTool = null;

        canvas.renderAll();
      }
      return;
    }

    // Handle spacebar for temporary pan mode
    if (e.code === "Space" && !isSpacebarPressed) {
      e.preventDefault();
      isSpacebarPressed = true;

      // Store current state
      previousCursor = canvas.defaultCursor;
      previousTool = currentTool;

      // Switch to temporary pan mode
      canvas.defaultCursor = "grab";
      canvas.setCursor("grab");
      canvas.selection = false;

      // Disable object selection temporarily
      canvas.forEachObject((obj) => {
        if (obj.type === "rect") {
          obj.selectable = false;
          obj.evented = false;
        }
      });

      canvas.renderAll();
      return;
    }

    // Other keyboard shortcuts (only if spacebar is not pressed and c key is not toggled)
    if (!isSpacebarPressed && !isCKeyToggled) {
      switch (e.key.toLowerCase()) {
        case "v":
          selectToolMode("select");
          break;
        case "b":
          selectToolMode("box");
          break;
        case "h":
          selectToolMode("pan");
          break;
        case "delete":
        case "backspace":
          deleteBtn.click();
          break;
        case "escape":
          if (isDrawingMode) {
            exitDrawingMode();
            selectToolMode("select");
          }
          break;
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && isSpacebarPressed) {
      e.preventDefault();
      isSpacebarPressed = false;
      isSpacebarPanning = false;
      lastSpacebarPanPoint = null;

      // Restore previous state
      canvas.defaultCursor = previousCursor || "default";
      canvas.setCursor(previousCursor || "default");

      // Restore tool mode
      if (previousTool) {
        selectToolMode(previousTool);
      }

      // Clear stored state
      previousCursor = null;
      previousTool = null;

      canvas.renderAll();
    }
  });

  // Enhanced canvas mouse event handlers
  canvas.on("mouse:down", (opt) => {
    const e = opt.e;

    // Handle 'c' key toggle drag mode
    if (isCKeyToggled) {
      isCKeyPanning = true;
      lastCKeyPanPoint = { x: e.clientX, y: e.clientY };
      canvas.setCursor("grabbing");
      return;
    }

    // Handle spacebar panning
    if (isSpacebarPressed) {
      isSpacebarPanning = true;
      lastSpacebarPanPoint = { x: e.clientX, y: e.clientY };
      canvas.setCursor("grabbing");
      return;
    }

    // Original mouse down logic
    if (currentTool === "pan") {
      isPanning = true;
      lastPanPoint = { x: e.clientX, y: e.clientY };
      canvas.setCursor("grabbing");
    } else if (isDrawingMode && currentTool === "box") {
      firstPoint = canvas.getPointer(e);
      previewRect = createRect({
        left: firstPoint.x,
        top: firstPoint.y,
        width: 0,
        height: 0,
      });
      previewRect.set({ isPreview: true, strokeDashArray: [5, 5] });
    }
  });

  canvas.on("mouse:move", (opt) => {
    const e = opt.e;

    // Handle 'c' key toggle drag mode
    if (isCKeyPanning && lastCKeyPanPoint) {
      canvas.relativePan({
        x: e.clientX - lastCKeyPanPoint.x,
        y: e.clientY - lastCKeyPanPoint.y,
      });
      lastCKeyPanPoint = { x: e.clientX, y: e.clientY };
      return;
    }

    // Handle spacebar panning
    if (isSpacebarPanning && lastSpacebarPanPoint) {
      canvas.relativePan({
        x: e.clientX - lastSpacebarPanPoint.x,
        y: e.clientY - lastSpacebarPanPoint.y,
      });
      lastSpacebarPanPoint = { x: e.clientX, y: e.clientY };
      return;
    }

    // Original mouse move logic
    if (isPanning) {
      canvas.relativePan({
        x: e.clientX - lastPanPoint.x,
        y: e.clientY - lastPanPoint.y,
      });
      lastPanPoint = { x: e.clientX, y: e.clientY };
    } else if (isDrawingMode && previewRect) {
      const pointer = canvas.getPointer(e);
      const deltaX = pointer.x - firstPoint.x;
      const deltaY = pointer.y - firstPoint.y;

      // บังคับให้เป็นสี่เหลี่ยมจัตุรัส โดยใช้ค่าที่มากกว่า
      const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));

      // กำหนดทิศทางของการวาด
      const left = deltaX >= 0 ? firstPoint.x : firstPoint.x - size;
      const top = deltaY >= 0 ? firstPoint.y : firstPoint.y - size;

      previewRect.set({
        width: size,
        height: size,
        left: left,
        top: top,
      });
      canvas.renderAll();
    }
  });

  canvas.on("mouse:up", () => {
    // Handle 'c' key toggle drag mode
    if (isCKeyPanning) {
      isCKeyPanning = false;
      canvas.setCursor("grab");
      return;
    }

    // Handle spacebar panning
    if (isSpacebarPanning) {
      isSpacebarPanning = false;
      canvas.setCursor("grab");
      return;
    }

    // Original mouse up logic
    if (isPanning) {
      isPanning = false;
      canvas.setCursor("grab");
    }

    if (isDrawingMode && previewRect) {
      if (previewRect.width > 5 && previewRect.height > 5) {
        const finalRect = createRect({
          left: previewRect.left,
          top: previewRect.top,
          width: previewRect.width,
          height: previewRect.height,
        });
        socket.emit("annotation:create", {
          filename: currentImage.filename,
          annotation: {
            id: finalRect.id,
            left: finalRect.left,
            top: finalRect.top,
            width: finalRect.width,
            height: finalRect.height,
          },
        });
        updateStatus();
      }
      exitDrawingMode();
      selectToolMode("select");
    }
  });

  // Enhanced selectToolMode function to work with spacebar and 'c' key toggle
  function selectToolMode(tool) {
    // Don't change tools if spacebar is pressed or 'c' key is toggled
    if (isSpacebarPressed || isCKeyToggled) {
      return;
    }

    exitDrawingMode();

    currentTool = tool;
    [selectToolBtn, boxToolBtn, panToolBtn].forEach((btn) =>
      btn.classList.remove("active"),
    );
    document.getElementById(tool + "Tool").classList.add("active");

    canvas.isDrawingMode = false;

    if (tool === "select") {
      canvas.selection = true;
      canvas.defaultCursor = "default";
      canvas.forEachObject((obj) => {
        if (obj.type === "rect") {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    } else if (tool === "pan") {
      canvas.selection = false;
      canvas.defaultCursor = "grab";
    } else if (tool === "box") {
      canvas.selection = false;
      canvas.defaultCursor = "crosshair";
      canvas.forEachObject((obj) => {
        if (obj.type === "rect") {
          obj.selectable = false;
          obj.evented = false;
        }
      });
      startDrawingMode();
    }
    canvas.renderAll();
  }

  clearBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all boxes on this image?")) {
      canvas
        .getObjects()
        .filter((o) => o.type === "rect")
        .forEach((obj) => {
          socket.emit("annotation:delete", {
            filename: currentImage.filename,
            annotationId: obj.id,
          });
          canvas.remove(obj);
        });
      canvas.renderAll();
      updateStatus();
    }
  });

  deleteBtn.addEventListener("click", () => {
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      activeObjects.forEach((obj) => {
        socket.emit("annotation:delete", {
          filename: currentImage.filename,
          annotationId: obj.id,
        });
        canvas.remove(obj);
      });
      canvas.discardActiveObject();
      canvas.renderAll();
      updateStatus();
    }
  });

  canvas.on("mouse:wheel", (opt) => {
    opt.e.preventDefault();
    opt.e.stopPropagation();
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    
    // คำนวณการจำกัดการซูมตามขนาดของ canvas
    const maxZoom = Math.max(50, Math.min(currentImage.width, currentImage.height) / 10);
    const minZoom = Math.max(0.01, Math.min(800 / currentImage.width, 600 / currentImage.height) * 0.1);
    
    if (zoom > maxZoom) zoom = maxZoom;
    if (zoom < minZoom) zoom = minZoom;
    
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    const percentage = Math.round(zoom * 100);
    zoomLevelDisplay.textContent = `${percentage}%`;
    statusZoom.textContent = `${percentage}%`;
  });

  canvas.on("object:modified", (opt) => {
    const target = opt.target;
    if (target.type === "rect") {
      target.set({
        // Apply scaling to object dimensions
        width: target.width * target.scaleX,
        height: target.height * target.scaleY,
        scaleX: 1,
        scaleY: 1,
      });
      socket.emit("annotation:update", {
        filename: currentImage.filename,
        annotation: {
          id: target.id,
          left: target.left,
          top: target.top,
          width: target.width,
          height: target.height,
        },
      });
      canvas.renderAll();
      updateStatus();
    }
  });

  // เพิ่ม event handler สำหรับการปรับขนาด box ให้เป็นสี่เหลี่ยมจัตุรัส
  // เพิ่มโค้ดนี้ใน client.js หลังจาก canvas.on("object:modified", ...)

  canvas.on("object:scaling", (opt) => {
    const target = opt.target;
    if (target.type === "rect" && !target.isPreview) {
      // คำนวณขนาดใหม่โดยใช้ค่าที่ใหญ่กว่าระหว่าง scaleX และ scaleY
      const maxScale = Math.max(target.scaleX, target.scaleY);

      // บังคับให้ scale ทั้งสองแกนเท่ากัน
      target.set({
        scaleX: maxScale,
        scaleY: maxScale,
      });

      canvas.renderAll();
    }
  });

  // หรือถ้าต้องการให้ box คงสัดส่วนสี่เหลี่ยมจัตุรัสตั้งแต่ตอนสร้าง
  // แก้ไขฟังก์ชัน createRect ให้รองรับการล็อกสัดส่วน
  function createRect(options) {
    const rect = new fabric.Rect({
      left: options.left,
      top: options.top,
      width: options.width,
      height: options.height,
      fill: `${fillColorInput.value}80`,
      stroke: strokeColorInput.value,
      strokeWidth: 2,
      id: options.id || Date.now(),
      selectable: currentTool === "select",
      evented: currentTool === "select",
      transparentCorners: false,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#000000",
      cornerStyle: "circle",
      cornerSize: 10,
      // เพิ่ม properties เหล่านี้เพื่อควบคุมการปรับขนาด
      lockUniScaling: true, // ล็อกให้ scale แบบสมส่วน
      centeredScaling: false, // ไม่ให้ scale จากจุดกึ่งกลาง
      centeredRotation: false, // ไม่ให้หมุนจากจุดกึ่งกลาง
    });

    // เพิ่ม event listener เฉพาะสำหรับ rect นี้
    rect.on("scaling", function () {
      // บังคับให้เป็นสี่เหลี่ยมจัตุรัสเสมอ
      const maxScale = Math.max(this.scaleX, this.scaleY);
      this.set({
        scaleX: maxScale,
        scaleY: maxScale,
      });
    });

    canvas.add(rect);
    return rect;
  }

  canvas.on("selection:created", updateAnnotationList);
  canvas.on("selection:updated", updateAnnotationList);
  canvas.on("selection:cleared", updateAnnotationList);

  // --- SOCKET.IO EVENT HANDLERS ---

  socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
    loadImageGallery();
  });

  socket.on("annotations:loaded", ({ filename, annotations }) => {
    if (filename === currentImage.filename) {
      annotations.forEach((ann) => createRect(ann));
      updateStatus();
      canvas.renderAll();
    }
  });

  socket.on("annotation:created", ({ filename, annotation }) => {
    if (
      filename === currentImage.filename &&
      !canvas.getObjects().find((obj) => obj.id === annotation.id)
    ) {
      createRect(annotation);
      updateStatus();
      canvas.renderAll();
    }
  });

  socket.on("annotation:updated-remote", ({ filename, annotation }) => {
    if (filename === currentImage.filename) {
      const obj = canvas.getObjects().find((o) => o.id === annotation.id);
      if (obj) {
        obj.set({
          left: annotation.left,
          top: annotation.top,
          width: annotation.width,
          height: annotation.height,
          scaleX: 1,
          scaleY: 1,
        });
        canvas.renderAll();
        updateStatus();
      }
    }
  });

  socket.on("annotation:deleted-remote", ({ filename, annotationId }) => {
    if (filename === currentImage.filename) {
      const obj = canvas.getObjects().find((o) => o.id === annotationId);
      if (obj) {
        canvas.remove(obj);
        canvas.renderAll();
        updateStatus();
      }
    }
  });

  // --- INITIALIZE APP ---
  saveBtn.disabled = true;
  clearBtn.disabled = true;
});

/* CubingIndia Dashboard - Frontend Logic (v5 - with Date Filters & Sales Trend) */

const API = "";
let _consignments = [];
let _products = [];
let _saleItemCounter = 0;
let _revenuePieChart = null;
let _inventoryDonut = null;
let _salesTrendChart = null;
let _dashboardRange = { start: null, end: null, label: "All Time" };

// ── Helpers ──────────────────────────────────────────────

function fmt(n) {
    return "\u20B9" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDec(n) {
    return "\u20B9" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUSD(n) {
    return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toast(msg, type = "success") {
    const c = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type} border-0 show`;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

async function api(method, path, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    const j = await r.json();
    if (!j.ok) throw new Error(j.msg || "API error");
    return j.data;
}

// ── Tab Navigation ──────────────────────────────────────

document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("d-none"));
        document.getElementById("tab-" + btn.dataset.tab).classList.remove("d-none");
        switch (btn.dataset.tab) {
            case "dashboard": loadDashboard(); break;
            case "consignments": loadConsignments(); break;
            case "inventory": loadInventory(); break;
            case "unified": loadUnifiedInventory(); break;
            case "sales": loadSales(); break;
            case "expenses": loadExpenses(); break;
            case "revenue": loadRevenue(); break;
            case "xingle": loadXingleConfig(); break;
        }
    });
});

// ── Dashboard ──────────────────────────────────────────

async function loadDashboard() {
    try {
        // Build query string with date range
        let qs = "";
        if (_dashboardRange.start) qs += `start_date=${_dashboardRange.start}`;
        if (_dashboardRange.end) qs += `${qs ? "&" : ""}end_date=${_dashboardRange.end}`;
        const url = "/api/dashboard/summary" + (qs ? "?" + qs : "");

        const d = await api("GET", url);

        document.getElementById("netProfit").textContent = fmt(d.pnl.net_profit);
        document.getElementById("totalRevenue").textContent = fmt(d.pnl.sales_revenue + d.pnl.other_revenue);
        document.getElementById("inventoryValue").textContent = fmt(d.inventory.inventory_value);
        document.getElementById("itemsInStock").textContent = d.inventory.total_remaining;
        document.getElementById("itemsInStock").title = `${d.inventory.total_remaining} remaining (${d.inventory.total_remaining - d.inventory.total_allocated} sellable)`;

        const p = d.pnl;

        // Gross Margin card
        document.getElementById("grossMarginCard").textContent = p.gross_margin_pct + "%";

        // P&L tooltip content (shared for both hover cards)
        const pnlHTML = `
            <tr><td>Sales Revenue</td><td class="text-end">${fmt(p.sales_revenue)}</td></tr>
            <tr><td>Other Revenue</td><td class="text-end">${fmt(p.other_revenue)}</td></tr>
            <tr style="border-top:1px solid #4361ee"><td><strong>Total Revenue</strong></td>
                <td class="text-end"><strong>${fmt(p.sales_revenue + p.other_revenue)}</strong></td></tr>
            <tr><td class="ps-3" style="color:#8888aa">- COGS (Landed)</td>
                <td class="text-end text-negative">${fmt(p.total_cogs)}</td></tr>
            <tr><td><strong>Gross Profit</strong></td>
                <td class="text-end ${p.gross_profit >= 0 ? 'text-positive' : 'text-negative'}">
                <strong>${fmt(p.gross_profit)}</strong> <small>(${p.gross_margin_pct}%)</small></td></tr>
            <tr><td class="ps-3" style="color:#8888aa">- Operating Expenses</td>
                <td class="text-end text-negative">${fmt(p.operating_expenses)}</td></tr>
            <tr style="border-top:1px solid #4361ee"><td><strong>Net Profit</strong></td>
                <td class="text-end ${p.net_profit >= 0 ? 'text-positive' : 'text-negative'}">
                <strong>${fmt(p.net_profit)}</strong> <small>(${p.net_margin_pct}%)</small></td></tr>
        `;
        document.getElementById("pnlTableNet").innerHTML = pnlHTML;
        document.getElementById("pnlTableRev").innerHTML = pnlHTML;

        // Update charts
        renderRevenuePieChart(d.revenue_breakdown);
        renderInventoryDonut(d.inventory);
        renderSalesTrendChart(d.sales_trend || []);

    } catch (e) {
        toast("Dashboard error: " + e.message, "danger");
    }
}

// ── Charts ──────────────────────────────────────────

function renderRevenuePieChart(breakdown) {
    const ctx = document.getElementById("revenuePieChart");
    if (!ctx) return;

    const labels = [];
    const data = [];
    const colors = [];

    // Sales by channel
    const channelLabels = { shop: "Shop (Online)", competition: "Competition", exhibition: "Exhibition", other: "Other Sales" };
    const channelColors = { shop: "#0d6efd", competition: "#198754", exhibition: "#ffc107", other: "#6c757d" };

    for (const [ch, amount] of Object.entries(breakdown.sales_by_channel || {})) {
        if (amount > 0) {
            labels.push(channelLabels[ch] || ch);
            data.push(amount);
            colors.push(channelColors[ch] || "#6c757d");
        }
    }

    // Other revenue by source
    const sourceLabels = { competition_entry: "Entry Fees", sponsorship: "Sponsorship", exhibition_sales: "Exhibition Sales", prize_money: "Prize Money", other: "Other Revenue" };
    const sourceColors = { competition_entry: "#20c997", sponsorship: "#0dcaf0", exhibition_sales: "#fd7e14", prize_money: "#d63384", other: "#adb5bd" };

    for (const [src, amount] of Object.entries(breakdown.revenue_by_source || {})) {
        if (amount > 0) {
            labels.push(sourceLabels[src] || src);
            data.push(amount);
            colors.push(sourceColors[src] || "#adb5bd");
        }
    }

    if (_revenuePieChart) _revenuePieChart.destroy();

    _revenuePieChart = new Chart(ctx, {
        type: "pie",
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: "#1a1a2e",
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#e0e0e0", font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((value / total) * 100).toFixed(1);
                            return `${context.label}: ${fmt(value)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderInventoryDonut(inventory) {
    const ctx = document.getElementById("inventoryDonut");
    if (!ctx) return;

    const sold = inventory.total_sold || 0;
    const allocated = inventory.total_allocated || 0;
    const adjusted = inventory.total_adjusted || 0;
    const remaining = inventory.total_remaining || 0;

    if (_inventoryDonut) _inventoryDonut.destroy();

    _inventoryDonut = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Sold", "Allocated", "Adjusted (Damaged/Lost)", "In Stock"],
            datasets: [{
                data: [sold, allocated, adjusted, remaining],
                backgroundColor: ["#198754", "#ffc107", "#dc3545", "#0d6efd"],
                borderWidth: 2,
                borderColor: "#1a1a2e",
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#e0e0e0", font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${context.label}: ${value} units (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderSalesTrendChart(trend) {
    const ctx = document.getElementById("salesTrendChart");
    const noData = document.getElementById("noTrendData");
    if (!ctx) return;

    if (_salesTrendChart) _salesTrendChart.destroy();

    if (!trend || trend.length === 0) {
        ctx.style.display = "none";
        if (noData) noData.classList.remove("d-none");
        return;
    }
    ctx.style.display = "block";
    if (noData) noData.classList.add("d-none");

    const labels = trend.map(t => t.period);
    const revenue = trend.map(t => t.revenue);
    const profit = trend.map(t => t.profit);

    _salesTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Revenue",
                    data: revenue,
                    borderColor: "#2ec4b6",
                    backgroundColor: "rgba(46, 196, 182, 0.1)",
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: "#2ec4b6",
                    borderWidth: 2,
                },
                {
                    label: "Profit",
                    data: profit,
                    borderColor: "#4361ee",
                    backgroundColor: "rgba(67, 97, 238, 0.1)",
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: "#4361ee",
                    borderWidth: 2,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index",
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#e0e0e0", font: { size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${fmt(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#8888aa", font: { size: 11 } },
                    grid: { color: "rgba(255,255,255,0.05)" },
                },
                y: {
                    ticks: {
                        color: "#8888aa",
                        font: { size: 11 },
                        callback: function(value) { return fmt(value); }
                    },
                    grid: { color: "rgba(255,255,255,0.05)" },
                }
            }
        }
    });
}

// ── Date Range Filters ──────────────────────────────────

function setDateRange(range) {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const pad = (n) => String(n).padStart(2, "0");
    const fmtDate = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

    switch (range) {
        case "all":
            _dashboardRange = { start: null, end: null, label: "All Time" };
            break;
        case "mtd":
            _dashboardRange = { start: `${y}-${pad(m + 1)}-01`, end: fmtDate(today), label: "MTD" };
            break;
        case "qtd": {
            const qStart = Math.floor(m / 3) * 3;
            _dashboardRange = { start: `${y}-${pad(qStart + 1)}-01`, end: fmtDate(today), label: "QTD" };
            break;
        }
        case "ytd":
            _dashboardRange = { start: `${y}-01-01`, end: fmtDate(today), label: "YTD" };
            break;
    }

    // Clear custom date inputs
    document.getElementById("dateStart").value = _dashboardRange.start || "";
    document.getElementById("dateEnd").value = _dashboardRange.end || "";

    // Update active button
    document.querySelectorAll("#dateQuickFilters .btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.querySelector(`#dateQuickFilters [data-range="${range}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    // Update label
    document.getElementById("activeRangeLabel").textContent = `Showing: ${_dashboardRange.label}`;

    loadDashboard();
}

// Quick filter buttons
document.querySelectorAll("#dateQuickFilters .btn").forEach(btn => {
    btn.addEventListener("click", () => setDateRange(btn.dataset.range));
});

// Custom date range
document.getElementById("applyCustomDate").addEventListener("click", () => {
    const start = document.getElementById("dateStart").value;
    const end = document.getElementById("dateEnd").value;
    if (!start && !end) {
        setDateRange("all");
        return;
    }
    _dashboardRange = {
        start: start || null,
        end: end || null,
        label: (start || "...") + " to " + (end || "today")
    };

    // Remove active from quick buttons
    document.querySelectorAll("#dateQuickFilters .btn").forEach(b => b.classList.remove("active"));

    document.getElementById("activeRangeLabel").textContent = `Showing: ${_dashboardRange.label}`;
    loadDashboard();
});

// ── CSV Export ──────────────────────────────────────

async function exportCSV(type) {
    try {
        let data, filename, headers;

        if (type === "inventory") {
            if (_products.length === 0) _products = await api("GET", "/api/dashboard/inventory");
            headers = ["Product", "Brand", "Category", "Consignment", "Imported", "Sold", "Allocated", "Adjusted", "Sellable", "Unit USD", "Unit INR", "Inv Value INR", "Status"];
            data = _products.map(p => [
                p.product_name, p.brand || "", p.category || "", p.consignment_name,
                p.quantity_imported, p.quantity_sold, p.quantity_allocated, p.quantity_adjusted || 0,
                p.sellable, p.unit_cost_usd, p.unit_landed_inr, p.inventory_value_inr, p.status
            ]);
            filename = `cubingindia_inventory_${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === "unified") {
            if (_products.length === 0) _products = await api("GET", "/api/dashboard/inventory");
            headers = ["Product", "Brand", "Category", "Total Imported", "Total Sold", "Total Allocated", "Total Adjusted", "Total Remaining", "Avg Unit Cost INR", "Total Inv Value INR", "Consignment Count"];

            // Aggregate
            const unified = {};
            _products.forEach(p => {
                const key = `${p.product_name}|${p.brand || ""}|${p.category || ""}`;
                if (!unified[key]) {
                    unified[key] = { product_name: p.product_name, brand: p.brand, category: p.category, imported: 0, sold: 0, allocated: 0, adjusted: 0, remaining: 0, value: 0, consignments: new Set(), totalUnitCost: 0, count: 0 };
                }
                const u = unified[key];
                u.imported += p.quantity_imported;
                u.sold += p.quantity_sold;
                u.allocated += p.quantity_allocated;
                u.adjusted += (p.quantity_adjusted || 0);
                u.remaining += p.sellable;
                u.value += p.inventory_value_inr;
                u.consignments.add(p.consignment_name);
                u.totalUnitCost += p.unit_landed_inr;
                u.count++;
            });

            data = Object.values(unified).map(u => [
                u.product_name, u.brand || "", u.category || "",
                u.imported, u.sold, u.allocated, u.adjusted, u.remaining,
                Math.round(u.totalUnitCost / u.count), Math.round(u.value), u.consignments.size
            ]);
            filename = `cubingindia_unified_${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === "sales") {
            const sales = await api("GET", "/api/sales");
            headers = ["Date", "Channel", "Customer", "Total", "Discount", "Final Amount", "Notes"];
            data = sales.map(s => [
                s.sale_date, s.channel, s.customer_name || "", s.total_amount, s.discount, s.final_amount, s.notes || ""
            ]);
            filename = `cubingindia_sales_${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === "pnl") {
            const summary = await api("GET", "/api/dashboard/summary");
            const p = summary.pnl;
            headers = ["Metric", "Amount (INR)"];
            data = [
                ["Sales Revenue", p.sales_revenue],
                ["Other Revenue", p.other_revenue],
                ["Total Revenue", p.sales_revenue + p.other_revenue],
                ["Cost of Goods Sold", p.total_cogs],
                ["Gross Profit", p.gross_profit],
                ["Gross Margin %", p.gross_margin_pct],
                ["Operating Expenses", p.operating_expenses],
                ["Net Profit", p.net_profit],
                ["Net Margin %", p.net_margin_pct],
            ];
            filename = `cubingindia_pnl_${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === "expenses") {
            const expenses = await api("GET", "/api/expenses");
            headers = ["Date", "Category", "Description", "Amount (INR)", "Notes"];
            data = expenses.map(e => [
                e.expense_date, e.category, e.description || "", e.amount_inr, e.notes || ""
            ]);
            filename = `cubingindia_expenses_${new Date().toISOString().split('T')[0]}.csv`;
        }

        // Generate CSV
        const csvContent = [
            headers.join(","),
            ...data.map(row => row.map(cell => {
                const str = String(cell);
                return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(","))
        ].join("\n");

        // Download
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);

        toast(`Exported ${filename}`, "success");
    } catch (e) {
        toast("Export error: " + e.message, "danger");
    }
}

// ── Consignments ──────────────────────────────────────

function showConsignmentForm() {
    document.getElementById("consignmentForm").classList.remove("d-none");
    document.getElementById("consignmentFormFields").reset();
    document.querySelector('[name="usd_inr_rate"]').value = "84.00";
}

function hideConsignmentForm() {
    document.getElementById("consignmentForm").classList.add("d-none");
}

document.getElementById("consignmentFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    // Convert numeric fields
    data.total_cogs_usd = parseFloat(data.total_cogs_usd) || 0;
    data.total_freight_usd = parseFloat(data.total_freight_usd) || 0;
    data.usd_inr_rate = parseFloat(data.usd_inr_rate) || 84.0;
    try {
        await api("POST", "/api/consignments", data);
        toast("Consignment created");
        hideConsignmentForm();
        loadConsignments();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function loadConsignments() {
    try {
        _consignments = await api("GET", "/api/consignments");
        const list = document.getElementById("consignmentList");
        list.innerHTML = _consignments.map(c => {
            const l = c._landed || {};
            const reconOk = c._recon_ok;
            return `
            <div class="card mb-2">
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${c.name}</strong>
                            <span class="ms-2 text-secondary small">${c.supplier || ""} ${c.invoice_number ? "#" + c.invoice_number : ""}</span>
                            <span class="ms-2 text-secondary small">${c.invoice_date || ""}</span>
                        </div>
                        <div>
                            <span class="badge bg-secondary me-1">COGS: ${fmtUSD(c.total_cogs_usd)}</span>
                            <span class="badge bg-secondary me-1">Freight: ${fmtUSD(c.total_freight_usd)}</span>
                            <span class="badge bg-info me-1">@ ${fmtDec(c.usd_inr_rate)}/$</span>
                            <span class="badge bg-primary me-1">Landed: ${fmt(l.total_landed_inr)}</span>
                            ${reconOk
                                ? '<span class="badge bg-success me-1"><i class="bi bi-check-lg"></i> Reconciled</span>'
                                : `<span class="badge bg-danger me-1" title="Products sum vs Consignment COGS mismatch">
                                    <i class="bi bi-exclamation-triangle"></i> Diff: ${fmtUSD(c._recon_diff)}
                                   </span>`
                            }
                            <button class="btn btn-outline-primary btn-sm" onclick="manageConsignmentProducts('${c.id}', '${c.name}')">
                                <i class="bi bi-box"></i> Products
                            </button>
                            <button class="btn btn-outline-primary btn-sm" onclick="showConsExpForm('${c.id}')">
                                <i class="bi bi-plus"></i> Handling
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteConsignment('${c.id}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div id="cons-details-${c.id}" class="mt-2 d-none"></div>
                </div>
            </div>
            `;
        }).join("");

        updateConsignmentDropdowns();
    } catch (e) {
        toast("Consignments error: " + e.message, "danger");
    }
}

async function manageConsignmentProducts(cid, name) {
    const el = document.getElementById("cons-details-" + cid);
    if (!el.classList.contains("d-none")) {
        el.classList.add("d-none");
        return;
    }
    el.classList.remove("d-none");

    const expenses = await api("GET", `/api/consignment-expenses?consignment_id=${cid}`);
    const products = await api("GET", `/api/products?consignment_id=${cid}`);

    // Reconciliation
    const productsCogUsd = products.reduce((sum, p) =>
        sum + (parseFloat(p.unit_cost_usd || 0) * parseInt(p.quantity_imported || 0)), 0);

    el.innerHTML = `
        <div class="row">
            <div class="col-md-5">
                <div class="small fw-bold mb-1">Handling Expenses (INR)</div>
                ${expenses.length === 0 ? '<div class="text-secondary small">No handling expenses yet</div>' : ''}
                <table class="table table-sm mb-0">
                    ${expenses.map(e => `
                        <tr>
                            <td>${e.expense_type}</td>
                            <td class="text-end">${fmt(e.amount_inr)}</td>
                            <td>${e.expense_date || ""}</td>
                            <td><button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="deleteConsExp('${e.id}', '${cid}', '${name}')"><i class="bi bi-x"></i></button></td>
                        </tr>
                    `).join("")}
                </table>
            </div>
            <div class="col-md-7">
                <div class="small fw-bold mb-1 d-flex justify-content-between">
                    <span>Products (${products.length})</span>
                    <span class="small">
                        Products COGS: <strong>${fmtUSD(productsCogUsd)}</strong>
                        ${Math.abs(productsCogUsd - (parseFloat(document.querySelector(`[data-cons-cogs="${cid}"]`)?.dataset.consCogs || 0))) > 0.01
                            ? '<span class="badge bg-danger ms-1">Mismatch</span>'
                            : '<span class="badge bg-success ms-1">OK</span>'}
                    </span>
                </div>
                <table class="table table-sm mb-0">
                    <thead><tr><th>Product</th><th>Brand</th><th>Qty</th><th class="text-end">Unit USD</th><th>Status</th></tr></thead>
                    ${products.map(p => `
                        <tr>
                            <td>${p.product_name}</td>
                            <td>${p.brand || ""}</td>
                            <td>${p.quantity_imported}</td>
                            <td class="text-end">${fmtUSD(p.unit_cost_usd)}</td>
                            <td><span class="badge badge-${(p.status || 'in_stock').replace('_', '-')}">${p.status || 'in_stock'}</span></td>
                        </tr>
                    `).join("")}
                </table>
            </div>
        </div>
    `;
}

function showConsExpForm(cid) {
    document.getElementById("consignmentExpForm").classList.remove("d-none");
    document.querySelector('#consExpFormFields [name="consignment_id"]').value = cid;
}

document.getElementById("consExpFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.amount_inr = parseFloat(data.amount_inr) || 0;
    try {
        await api("POST", "/api/consignment-expenses", data);
        toast("Handling expense added");
        document.getElementById("consignmentExpForm").classList.add("d-none");
        loadConsignments();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function deleteConsExp(eid, cid, name) {
    if (!confirm("Delete this expense?")) return;
    try {
        await api("DELETE", `/api/consignment-expenses/${eid}`);
        toast("Deleted");
        manageConsignmentProducts(cid, name);
    } catch (e) { toast(e.message, "danger"); }
}

async function deleteConsignment(cid) {
    if (!confirm("Delete this consignment and all its products/expenses?")) return;
    try {
        await api("DELETE", `/api/consignments/${cid}`);
        toast("Deleted");
        loadConsignments();
    } catch (e) { toast(e.message, "danger"); }
}

// ── Inventory ──────────────────────────────────────

function showProductForm() {
    document.getElementById("productForm").classList.remove("d-none");
    document.getElementById("productFormFields").reset();
    updateConsignmentDropdowns();
}

function hideProductForm() {
    document.getElementById("productForm").classList.add("d-none");
}

function updateConsignmentDropdowns() {
    const sel = document.querySelector('#productFormFields [name="consignment_id"]');
    sel.innerHTML = '<option value="">Select...</option>' +
        _consignments.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

    const filterSel = document.getElementById("invConsignmentFilter");
    if (filterSel) {
        filterSel.innerHTML = '<option value="">All Consignments</option>' +
            _consignments.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    }
}

document.getElementById("productFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.quantity_imported = parseInt(data.quantity_imported) || 0;
    data.unit_cost_usd = parseFloat(data.unit_cost_usd) || 0;
    try {
        await api("POST", "/api/products", data);
        toast("Product added");
        hideProductForm();
        loadInventory();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function loadInventory() {
    try {
        if (_consignments.length === 0) _consignments = await api("GET", "/api/consignments");
        updateConsignmentDropdowns();

        _products = await api("GET", "/api/dashboard/inventory");
        renderInventory();
    } catch (e) {
        toast("Inventory error: " + e.message, "danger");
    }
}

function renderInventory() {
    const status = document.getElementById("invStatusFilter").value;
    const cons = document.getElementById("invConsignmentFilter").value;

    let filtered = _products;
    if (status) filtered = filtered.filter(p => p.status === status);
    if (cons) filtered = filtered.filter(p => {
        const c = _consignments.find(c => c.name === p.consignment_name);
        return c && c.id === cons;
    });

    const tbody = document.getElementById("inventoryTable");
    tbody.innerHTML = filtered.map(p => `
        <tr>
            <td>${p.product_name}</td>
            <td>${p.brand || ""}</td>
            <td>${p.category || ""}</td>
            <td class="small">${p.consignment_name}</td>
            <td class="text-center">${p.quantity_imported}</td>
            <td class="text-center">${p.quantity_sold}</td>
            <td class="text-center">${p.quantity_allocated > 0 ? '<span class="badge bg-warning text-dark">' + p.quantity_allocated + '</span>' : '0'}</td>
            <td class="text-center">${p.quantity_adjusted > 0 ? '<span class="badge bg-danger">' + p.quantity_adjusted + '</span>' : '0'}</td>
            <td class="text-center fw-bold">${p.sellable}</td>
            <td class="text-end">${fmtUSD(p.unit_cost_usd)}</td>
            <td class="text-end">${fmtDec(p.unit_landed_inr)}</td>
            <td class="text-end">${fmt(p.inventory_value_inr)}</td>
            <td><span class="badge badge-${(p.status || 'in_stock').replace('_', '-')}">${p.status || 'in_stock'}</span></td>
            <td>
                ${p.sellable > 0 ? `<button class="btn btn-outline-warning btn-sm py-0 px-1 me-1" onclick="showAllocateForm('${p.id}', '${p.product_name}', ${p.sellable})" title="Allocate for company/promotion"><i class="bi bi-bookmark"></i></button>` : ''}
                <button class="btn btn-outline-danger btn-sm py-0 px-1 me-1" onclick="showAdjustForm('${p.id}', '${p.product_name}', ${p.sellable})" title="Adjust stock (damaged/lost/returned)">
                    <i class="bi bi-exclamation-triangle"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="deleteProduct('${p.id}')">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");

    // Totals
    const totals = filtered.reduce((a, p) => ({
        imported: a.imported + p.quantity_imported,
        sold: a.sold + p.quantity_sold,
        allocated: a.allocated + p.quantity_allocated,
        adjusted: a.adjusted + (p.quantity_adjusted || 0),
        sellable: a.sellable + p.sellable,
        value: a.value + p.inventory_value_inr,
    }), { imported: 0, sold: 0, allocated: 0, adjusted: 0, sellable: 0, value: 0 });

    document.getElementById("invTotalImported").textContent = totals.imported;
    document.getElementById("invTotalSold").textContent = totals.sold;
    document.getElementById("invTotalAllocated").textContent = totals.allocated;
    document.getElementById("invTotalAdjusted").textContent = totals.adjusted;
    document.getElementById("invTotalSellable").textContent = totals.sellable;
    document.getElementById("invTotalValue").textContent = fmt(totals.value);
}

document.getElementById("invStatusFilter").addEventListener("change", renderInventory);
document.getElementById("invConsignmentFilter").addEventListener("change", renderInventory);

async function deleteProduct(pid) {
    if (!confirm("Delete this product?")) return;
    try {
        await api("DELETE", `/api/products/${pid}`);
        toast("Deleted");
        loadInventory();
    } catch (e) { toast(e.message, "danger"); }
}

// ── Unified Inventory ──────────────────────────────────

async function loadUnifiedInventory() {
    try {
        if (_products.length === 0) _products = await api("GET", "/api/dashboard/inventory");

        // Populate filter dropdowns
        const categories = [...new Set(_products.map(p => p.category).filter(Boolean))].sort();
        const brands = [...new Set(_products.map(p => p.brand).filter(Boolean))].sort();

        const catSel = document.getElementById("uniCategoryFilter");
        catSel.innerHTML = '<option value="">All Categories</option>' +
            categories.map(c => `<option value="${c}">${c}</option>`).join("");

        const brandSel = document.getElementById("uniBrandFilter");
        brandSel.innerHTML = '<option value="">All Brands</option>' +
            brands.map(b => `<option value="${b}">${b}</option>`).join("");

        renderUnifiedInventory();
    } catch (e) {
        toast("Unified inventory error: " + e.message, "danger");
    }
}

function renderUnifiedInventory() {
    const category = document.getElementById("uniCategoryFilter").value;
    const brand = document.getElementById("uniBrandFilter").value;

    let filtered = _products;
    if (category) filtered = filtered.filter(p => p.category === category);
    if (brand) filtered = filtered.filter(p => p.brand === brand);

    // Aggregate by product_name + brand + category
    const unified = {};
    filtered.forEach(p => {
        const key = `${p.product_name}|${p.brand || ""}|${p.category || ""}`;
        if (!unified[key]) {
            unified[key] = {
                product_name: p.product_name,
                brand: p.brand,
                category: p.category,
                imported: 0,
                sold: 0,
                allocated: 0,
                adjusted: 0,
                remaining: 0,
                value: 0,
                consignments: new Set(),
                totalUnitCost: 0,
                count: 0,
            };
        }
        const u = unified[key];
        u.imported += p.quantity_imported;
        u.sold += p.quantity_sold;
        u.allocated += p.quantity_allocated;
        u.adjusted += (p.quantity_adjusted || 0);
        u.remaining += p.sellable;
        u.value += p.inventory_value_inr;
        u.consignments.add(p.consignment_name);
        u.totalUnitCost += p.unit_landed_inr;
        u.count++;
    });

    const rows = Object.values(unified).sort((a, b) => b.value - a.value);

    const tbody = document.getElementById("unifiedTable");
    tbody.innerHTML = rows.map(u => `
        <tr>
            <td>${u.product_name}</td>
            <td>${u.brand || ""}</td>
            <td>${u.category || ""}</td>
            <td class="text-center">${u.imported}</td>
            <td class="text-center">${u.sold}</td>
            <td class="text-center">${u.allocated > 0 ? '<span class="badge bg-warning text-dark">' + u.allocated + '</span>' : '0'}</td>
            <td class="text-center">${u.adjusted > 0 ? '<span class="badge bg-danger">' + u.adjusted + '</span>' : '0'}</td>
            <td class="text-center fw-bold">${u.remaining}</td>
            <td class="text-end">${fmtDec(u.totalUnitCost / u.count)}</td>
            <td class="text-end">${fmt(u.value)}</td>
            <td class="text-center"><span class="badge bg-secondary">${u.consignments.size}</span></td>
        </tr>
    `).join("");

    // Totals
    const totals = rows.reduce((a, u) => ({
        imported: a.imported + u.imported,
        sold: a.sold + u.sold,
        allocated: a.allocated + u.allocated,
        adjusted: a.adjusted + u.adjusted,
        remaining: a.remaining + u.remaining,
        value: a.value + u.value,
    }), { imported: 0, sold: 0, allocated: 0, adjusted: 0, remaining: 0, value: 0 });

    document.getElementById("uniTotalImported").textContent = totals.imported;
    document.getElementById("uniTotalSold").textContent = totals.sold;
    document.getElementById("uniTotalAllocated").textContent = totals.allocated;
    document.getElementById("uniTotalAdjusted").textContent = totals.adjusted;
    document.getElementById("uniTotalRemaining").textContent = totals.remaining;
    document.getElementById("uniTotalValue").textContent = fmt(totals.value);
}

document.getElementById("uniCategoryFilter").addEventListener("change", renderUnifiedInventory);
document.getElementById("uniBrandFilter").addEventListener("change", renderUnifiedInventory);

// ── Stock Allocation ──────────────────────────────────

let _allocProductId = null;

function showAllocateForm(pid, name, maxQty) {
    _allocProductId = pid;
    document.getElementById("allocProductName").textContent = name;
    document.getElementById("allocMaxQty").textContent = maxQty;
    const qtyInput = document.querySelector('#allocateFormFields [name="quantity"]');
    qtyInput.max = maxQty;
    qtyInput.value = 1;
    document.querySelector('#allocateFormFields [name="reason"]').value = "";
    document.getElementById("allocateModal").classList.remove("d-none");
}

function hideAllocateForm() {
    document.getElementById("allocateModal").classList.add("d-none");
    _allocProductId = null;
}

async function submitAllocation() {
    const form = document.getElementById("allocateFormFields");
    const data = {
        product_id: _allocProductId,
        allocation_type: form.querySelector('[name="allocation_type"]').value,
        quantity: parseInt(form.querySelector('[name="quantity"]').value) || 1,
        allocation_date: form.querySelector('[name="allocation_date"]').value || null,
        reason: form.querySelector('[name="reason"]').value,
    };
    try {
        await api("POST", "/api/allocations", data);
        toast("Stock allocated");
        hideAllocateForm();
        loadInventory();
    } catch (err) {
        toast(err.message, "danger");
    }
}

// ── Stock Adjustment ──────────────────────────────────

let _adjProductId = null;

function showAdjustForm(pid, name, maxQty) {
    _adjProductId = pid;
    document.getElementById("adjProductName").textContent = name;
    document.getElementById("adjMaxQty").textContent = maxQty;
    const qtyInput = document.querySelector('#adjustFormFields [name="quantity"]');
    qtyInput.max = maxQty;
    qtyInput.value = 1;
    document.querySelector('#adjustFormFields [name="reason"]').value = "";
    document.querySelector('#adjustFormFields [name="adjustment_date"]').value = new Date().toISOString().split('T')[0];
    document.getElementById("adjustModal").classList.remove("d-none");
}

function hideAdjustForm() {
    document.getElementById("adjustModal").classList.add("d-none");
    _adjProductId = null;
}

async function submitAdjustment() {
    const form = document.getElementById("adjustFormFields");
    const adjType = form.querySelector('[name="adjustment_type"]').value;
    const qty = parseInt(form.querySelector('[name="quantity"]').value) || 1;

    const confirmMsg = adjType === "damaged" || adjType === "lost"
        ? `Mark ${qty} unit(s) as ${adjType}? This will reduce sellable stock.`
        : adjType === "returned" || adjType === "found"
        ? `Restore ${qty} unit(s) to stock?`
        : `Apply correction of ${qty} unit(s)?`;

    if (!confirm(confirmMsg)) return;

    const data = {
        product_id: _adjProductId,
        adjustment_type: adjType,
        quantity: qty,
        adjustment_date: form.querySelector('[name="adjustment_date"]').value || null,
        reason: form.querySelector('[name="reason"]').value,
    };

    try {
        await api("POST", "/api/adjustments", data);
        toast(`Stock adjusted: ${adjType}`);
        hideAdjustForm();
        loadInventory();
    } catch (err) {
        toast(err.message, "danger");
    }
}

// ── Sales ──────────────────────────────────────────

async function showSaleForm() {
    document.getElementById("saleForm").classList.remove("d-none");
    document.getElementById("saleFormFields").reset();
    document.getElementById("saleItemsContainer").innerHTML = "";
    _saleItemCounter = 0;
    await loadProductsForSale();
    addSaleItem();
}

function hideSaleForm() {
    document.getElementById("saleForm").classList.add("d-none");
}

async function loadProductsForSale() {
    if (_products.length === 0) {
        _products = await api("GET", "/api/dashboard/inventory");
    }
}

function addSaleItem() {
    _saleItemCounter++;
    const container = document.getElementById("saleItemsContainer");
    const div = document.createElement("div");
    div.className = "row g-2 mb-1 align-items-end sale-item-row";
    div.id = "saleItem-" + _saleItemCounter;
    div.innerHTML = `
        <div class="col-md-4">
            <select class="form-select form-select-sm" name="product_id" required onchange="updateSaleItemPrice(this)">
                <option value="">Select product...</option>
                ${_products.filter(p => p.sellable > 0).map(p =>
                    `<option value="${p.id}" data-price="${p.unit_landed_inr}">${p.product_name} (${p.brand || ''}) - ${p.sellable} sellable @ ${fmtDec(p.unit_landed_inr)}</option>`
                ).join("")}
            </select>
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control form-control-sm" name="quantity" value="1" min="1" placeholder="Qty" onchange="updateSaleTotal()">
        </div>
        <div class="col-md-2">
            <input type="number" step="0.01" class="form-control form-control-sm" name="selling_price" placeholder="Price (INR)" required onchange="updateSaleTotal()">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm" name="notes" placeholder="Notes">
        </div>
        <div class="col-md-1">
            <button type="button" class="btn btn-outline-danger btn-sm" onclick="removeSaleItem(${_saleItemCounter})">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `;
    container.appendChild(div);
}

function removeSaleItem(n) {
    const el = document.getElementById("saleItem-" + n);
    if (el) el.remove();
    updateSaleTotal();
}

function updateSaleItemPrice(sel) {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.price) {
        const row = sel.closest(".sale-item-row");
        const priceInput = row.querySelector('[name="selling_price"]');
        if (!priceInput.value) priceInput.value = opt.dataset.price;
    }
    updateSaleTotal();
}

function updateSaleTotal() {
    let total = 0;
    document.querySelectorAll(".sale-item-row").forEach(row => {
        const qty = parseInt(row.querySelector('[name="quantity"]')?.value) || 0;
        const price = parseFloat(row.querySelector('[name="selling_price"]')?.value) || 0;
        total += qty * price;
    });
    document.getElementById("saleTotalPreview").textContent = fmt(total);
}

document.getElementById("saleFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;

    // Collect ONLY header fields (not item row fields)
    const data = {
        sale_date: form.querySelector('[name="sale_date"]')?.value,
        channel: form.querySelector('[name="channel"]')?.value,
        customer_name: form.querySelector('[name="customer_name"]')?.value,
        discount: parseFloat(form.querySelector('[name="discount"]')?.value) || 0,
        notes: form.querySelector('[name="notes"]')?.value,
    };

    // Collect items from dynamically added rows
    const items = [];
    document.querySelectorAll(".sale-item-row").forEach(row => {
        const pid = row.querySelector('[name="product_id"]')?.value;
        const qty = row.querySelector('[name="quantity"]')?.value;
        const price = row.querySelector('[name="selling_price"]')?.value;
        const notes = row.querySelector('[name="notes"]')?.value;
        if (pid && price) {
            items.push({
                product_id: pid,
                quantity: parseInt(qty) || 1,
                selling_price: parseFloat(price),
                notes,
            });
        }
    });

    if (items.length === 0) {
        toast("Add at least one item", "warning");
        return;
    }
    data.items = items;

    try {
        await api("POST", "/api/sales", data);
        toast("Sale recorded");
        hideSaleForm();
        loadSales();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function loadSales() {
    try {
        const sales = await api("GET", "/api/sales");
        if (_products.length === 0) _products = await api("GET", "/api/dashboard/inventory");
        const prodMap = {};
        _products.forEach(p => prodMap[p.id] = p);

        const list = document.getElementById("salesList");
        list.innerHTML = sales.map(s => `
            <div class="card mb-2">
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${s.sale_date}</strong>
                            <span class="badge bg-secondary ms-2">${s.channel}</span>
                            ${s.customer_name ? `<span class="ms-2 text-secondary small">${s.customer_name}</span>` : ''}
                        </div>
                        <div>
                            <span class="badge bg-success me-2">${fmt(s.final_amount)}</span>
                            <button class="btn btn-outline-danger btn-sm py-0" onclick="deleteSale('${s.id}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                    ${s.items && s.items.length > 0 ? `
                    <table class="table table-sm mb-0 mt-1">
                        <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>COGS</th><th>Profit</th></tr></thead>
                        ${s.items.map(i => {
                            const prod = prodMap[i.product_id];
                            const name = prod ? prod.product_name : i.product_id.substring(0,8) + '...';
                            return `
                            <tr>
                                <td>${name}</td>
                                <td>${i.quantity}</td>
                                <td class="text-end">${fmt(i.selling_price)}</td>
                                <td class="text-end">${fmt((i.unit_cogs_inr || 0) + (i.unit_freight_inr || 0) + (i.unit_handling_inr || 0))}</td>
                                <td class="text-end ${i.line_profit >= 0 ? 'text-positive' : 'text-negative'}">${fmt(i.line_profit)}</td>
                            </tr>`;
                        }).join("")}
                    </table>
                    ` : ''}
                </div>
            </div>
        `).join("");
    } catch (e) {
        toast("Sales error: " + e.message, "danger");
    }
}

async function deleteSale(sid) {
    if (!confirm("Delete this sale? Product quantities will be restored.")) return;
    try {
        await api("DELETE", `/api/sales/${sid}`);
        toast("Sale deleted");
        loadSales();
    } catch (e) { toast(e.message, "danger"); }
}

// ── Expenses ──────────────────────────────────────

function showExpenseForm() {
    document.getElementById("expenseForm").classList.remove("d-none");
    document.getElementById("expenseFormFields").reset();
}

function hideExpenseForm() {
    document.getElementById("expenseForm").classList.add("d-none");
}

document.getElementById("expenseFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.amount_inr = parseFloat(data.amount_inr) || 0;
    try {
        await api("POST", "/api/expenses", data);
        toast("Expense recorded");
        hideExpenseForm();
        loadExpenses();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function loadExpenses() {
    try {
        const expenses = await api("GET", "/api/expenses");
        const tbody = document.getElementById("expenseTable");
        tbody.innerHTML = expenses.map(e => `
            <tr>
                <td>${e.expense_date || ""}</td>
                <td><span class="badge bg-secondary">${e.category}</span></td>
                <td>${e.description || ""}</td>
                <td class="text-end">${fmt(e.amount_inr)}</td>
                <td><button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="deleteExpense('${e.id}')"><i class="bi bi-trash"></i></button></td>
            </tr>
        `).join("");

        const total = expenses.reduce((a, e) => a + parseFloat(e.amount_inr || 0), 0);
        document.getElementById("expenseTotal").textContent = fmt(total);
    } catch (e) {
        toast("Expenses error: " + e.message, "danger");
    }
}

async function deleteExpense(eid) {
    if (!confirm("Delete this expense?")) return;
    try {
        await api("DELETE", `/api/expenses/${eid}`);
        toast("Deleted");
        loadExpenses();
    } catch (e) { toast(e.message, "danger"); }
}

// ── Revenue ──────────────────────────────────────

function showRevenueForm() {
    document.getElementById("revenueForm").classList.remove("d-none");
    document.getElementById("revenueFormFields").reset();
}

function hideRevenueForm() {
    document.getElementById("revenueForm").classList.add("d-none");
}

document.getElementById("revenueFormFields").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.amount_inr = parseFloat(data.amount_inr) || 0;
    try {
        await api("POST", "/api/revenue", data);
        toast("Revenue recorded");
        hideRevenueForm();
        loadRevenue();
    } catch (err) {
        toast(err.message, "danger");
    }
});

async function loadRevenue() {
    try {
        const rev = await api("GET", "/api/revenue");
        const tbody = document.getElementById("revenueTable");
        tbody.innerHTML = rev.map(r => `
            <tr>
                <td>${r.revenue_date || ""}</td>
                <td><span class="badge bg-secondary">${r.source}</span></td>
                <td>${r.description || ""}</td>
                <td class="text-end">${fmt(r.amount_inr)}</td>
                <td><button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="deleteRevenue('${r.id}')"><i class="bi bi-trash"></i></button></td>
            </tr>
        `).join("");

        const total = rev.reduce((a, r) => a + parseFloat(r.amount_inr || 0), 0);
        document.getElementById("revenueTotal").textContent = fmt(total);
    } catch (e) {
        toast("Revenue error: " + e.message, "danger");
    }
}

async function deleteRevenue(rid) {
    if (!confirm("Delete this revenue?")) return;
    try {
        await api("DELETE", `/api/revenue/${rid}`);
        toast("Deleted");
        loadRevenue();
    } catch (e) { toast(e.message, "danger"); }
}

// ── XingleToy Price Lookup ──────────────────────────────

let _xingleConfig = {};
let _xingleResults = [];

function toggleXingleSettings() {
    const body = document.getElementById("xingleSettingsBody");
    const icon = document.getElementById("xingleSettingsIcon");
    if (body.classList.contains("d-none")) {
        body.classList.remove("d-none");
        icon.className = "bi bi-chevron-up";
    } else {
        body.classList.add("d-none");
        icon.className = "bi bi-chevron-down";
    }
}

function toggleTokenVisibility() {
    const inp = document.getElementById("xingleTokenInput");
    const eye = document.getElementById("tokenEyeIcon");
    if (inp.type === "password") {
        inp.type = "text";
        eye.className = "bi bi-eye-slash";
    } else {
        inp.type = "password";
        eye.className = "bi bi-eye";
    }
}

async function loadXingleConfig() {
    try {
        const cfg = await api("GET", "/api/xingle/config");
        _xingleConfig = cfg;
        document.getElementById("xingleRate").value = cfg.usd_inr_rate;
        document.getElementById("xingleFreight").value = cfg.freight_pct;
        document.getElementById("xingleCustoms").value = cfg.customs_duty_pct;
        document.getElementById("xingleHandling").value = cfg.handling_inr_per_unit;
        document.getElementById("xingleMarkup").value = cfg.markup || 1.4;
        document.getElementById("xingleTokenInput").value = "";
        const status = document.getElementById("xingleTokenStatus");
        if (cfg.token_set) {
            status.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>Token: ${cfg.token_masked}</span>`;
        } else {
            status.innerHTML = '<span class="text-danger"><i class="bi bi-exclamation-circle me-1"></i>No token set — paste your Bearer token above</span>';
        }
    } catch (e) {
        toast("Failed to load XingleToy config: " + e.message, "danger");
    }
}

async function saveXingleConfig() {
    const token = document.getElementById("xingleTokenInput").value.trim();
    const data = {
        usd_inr_rate: parseFloat(document.getElementById("xingleRate").value) || 84,
        freight_pct: parseFloat(document.getElementById("xingleFreight").value) || 8,
        customs_duty_pct: parseFloat(document.getElementById("xingleCustoms").value) || 10,
        handling_inr_per_unit: parseFloat(document.getElementById("xingleHandling").value) || 30,
        markup: parseFloat(document.getElementById("xingleMarkup").value) || 1.4,
    };
    if (token) data.token = token;
    try {
        await api("POST", "/api/xingle/config", data);
        toast("XingleToy settings saved");
        loadXingleConfig();
    } catch (e) {
        toast("Save failed: " + e.message, "danger");
    }
}

async function searchXingle() {
    const keyword = document.getElementById("xingleSearchInput").value.trim();
    if (!keyword) {
        toast("Enter a search keyword", "warning");
        return;
    }
    const status = document.getElementById("xingleSearchStatus");
    status.innerHTML = '<span class="text-primary"><i class="bi bi-hourglass-split me-1"></i>Searching XingleToy catalog...</span>';

    try {
        const result = await api("POST", "/api/xingle/search", { keyword });
        _xingleResults = result.items || [];
        _xingleConfig = { ..._xingleConfig, ...result.config };
        renderXingleResults(result);
        status.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>Found ${result.total} products — showing ${_xingleResults.length}</span>`;
    } catch (e) {
        _xingleResults = [];
        status.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-circle me-1"></i>${e.message}</span>`;
        document.getElementById("xingleResultsArea").classList.add("d-none");
    }
}

function renderXingleResults(result) {
    const items = result.items;
    const cfg = result.config;
    const markup = parseFloat(document.getElementById("xingleMarkup").value) || 1.4;
    document.getElementById("xingleMarkupHeader").textContent = markup;

    if (!items || items.length === 0) {
        document.getElementById("xingleResultsArea").classList.add("d-none");
        return;
    }
    document.getElementById("xingleResultsArea").classList.remove("d-none");

    // Summary
    document.getElementById("xingleTotalProducts").textContent = items.length;
    const landedPrices = items.map(i => i.landed_inr);
    const minLanded = Math.min(...landedPrices);
    const maxLanded = Math.max(...landedPrices);
    document.getElementById("xinglePriceRange").textContent = `${fmt(minLanded)} – ${fmt(maxLanded)}`;
    const cheapest = items.reduce((a, b) => a.base_usd < b.base_usd ? a : b);
    document.getElementById("xingleCheapest").textContent = `${cheapest.name.substring(0, 20)} @ ${fmtUSD(cheapest.base_usd)}`;
    document.getElementById("xingleParamSummary").innerHTML =
        `₹${cfg.usd_inr_rate}/$ · ${cfg.freight_pct}% ship · ${cfg.customs_duty_pct}% duty · ₹${cfg.handling_inr_per_unit}/unit`;

    // Table
    const tbody = document.getElementById("xingleResultsTable");
    tbody.innerHTML = items.map(item => {
        const sellPrice = Math.ceil(item.landed_inr * markup);
        const marginClass = markup > 1 ? "text-success" : "text-warning";
        const tags = (item.tags || []).map(t => `<span class="badge bg-secondary me-1" style="font-size:10px">${t}</span>`).join("");
        const types = (item.types || []).map(t => `<span class="badge bg-dark border me-1" style="font-size:10px">${t}</span>`).join("");
        const badges = [];
        if (item.hot) badges.push('<span class="badge bg-danger" style="font-size:10px">HOT</span>');
        if (item.newest) badges.push('<span class="badge bg-info" style="font-size:10px">NEW</span>');
        if (item.discount_pct > 0) badges.push(`<span class="badge bg-warning text-dark" style="font-size:10px">-${item.discount_pct}%</span>`);

        return `<tr>
            <td><img src="${item.thumbnail}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'"></td>
            <td>
                <div class="small fw-bold">${item.name}</div>
                <div class="text-secondary" style="font-size:10px;font-family:monospace">${item.id}</div>
                <div>${types}${badges.join(" ")}</div>
            </td>
            <td class="text-end mono">${fmtUSD(item.base_usd)}</td>
            <td class="text-end mono">${fmt(item.base_inr)}</td>
            <td class="text-end mono small text-secondary">${fmt(item.freight_inr)}</td>
            <td class="text-end mono small text-secondary">${fmt(item.customs_inr)}</td>
            <td class="text-end mono small text-secondary">${fmt(item.handling_inr)}</td>
            <td class="text-end mono fw-bold">${fmt(item.landed_inr)}</td>
            <td class="text-end mono fw-bold ${marginClass}">${fmt(sellPrice)}</td>
            <td class="text-center">${item.moq}</td>
            <td>${tags}</td>
            <td>
                <button class="btn btn-outline-secondary btn-sm py-0 px-1" title="Copy pricing to clipboard"
                    onclick="copyXingleRow('${item.name.replace(/'/g, "\\'")}', ${item.base_usd}, ${item.landed_inr}, ${sellPrice})">
                    <i class="bi bi-clipboard"></i>
                </button>
            </td>
        </tr>`;
    }).join("");
}

function copyXingleRow(name, usd, landed, sell) {
    const text = `${name}\nXingle: $${usd.toFixed(2)} USD | Landed: ₹${landed.toFixed(0)} | Suggested Sell: ₹${sell}`;
    navigator.clipboard.writeText(text).then(() => {
        toast("Copied to clipboard");
    }).catch(() => {
        toast("Copy failed", "warning");
    });
}

function clearXingleResults() {
    _xingleResults = [];
    document.getElementById("xingleSearchInput").value = "";
    document.getElementById("xingleSearchStatus").innerHTML = "";
    document.getElementById("xingleResultsArea").classList.add("d-none");
}

function exportXingleCSV() {
    if (_xingleResults.length === 0) {
        toast("No results to export", "warning");
        return;
    }
    const markup = parseFloat(document.getElementById("xingleMarkup").value) || 1.4;
    const headers = ["Product", "USD", "Base INR", "Freight", "Customs", "Handling", "Landed INR", `Sell @ ${markup}×`, "MOQ", "Tags"];
    const data = _xingleResults.map(i => [
        i.name, i.base_usd, i.base_inr, i.freight_inr, i.customs_inr, i.handling_inr,
        i.landed_inr, Math.ceil(i.landed_inr * markup), i.moq, (i.tags || []).join("; ")
    ]);
    const csv = [headers.join(","), ...data.map(r => r.map(c => {
        const s = String(c);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `xingle_prices_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Exported XingleToy prices CSV");
}

// ── Init ──────────────────────────────────────────

loadDashboard();

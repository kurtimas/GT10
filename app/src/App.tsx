import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Scale from "./pages/Scale";
import Sheets from "./pages/Sheets";
import Shipments from "./pages/Shipments";
import Bins from "./pages/Bins";
import People from "./pages/People";
import Reports from "./pages/Reports";
import Audit from "./pages/Audit";
import NotFound from "@shared/src/pages/NotFound";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scale" element={<Scale />} />
        <Route path="/scale/:sheetId" element={<Scale />} />
        <Route path="/sheets" element={<Sheets />} />
        <Route path="/shipments" element={<Shipments />} />
        <Route path="/bins" element={<Bins />} />
        <Route path="/people" element={<People />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

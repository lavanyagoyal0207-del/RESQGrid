import React, { useEffect, useState } from 'react';

const RESOURCE_TYPES = [
  'Ambulance',
  'Rescue Team',
  'Medical Supplies',
  'Food and Water',
  'Temporary Shelter',
  'Rescue Equipment',
];

export default function ResourceManagementPanel({
  resources,
  incidents,
  selectedIncident,
  operator,
  onCreateResource,
  onUpdateResource,
  onAssignResource,
  isSubmitting,
}) {
  const [formError, setFormError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [assignmentIncidentId, setAssignmentIncidentId] = useState(
    selectedIncident?.incident_id || ''
  );

  useEffect(() => {
    if (selectedIncident?.incident_id) {
      setAssignmentIncidentId(selectedIncident.incident_id);
    }
  }, [selectedIncident?.incident_id]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setFormError('');
    setIsCreating(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const result = await onCreateResource({
      name: formData.get('name'),
      type: formData.get('type'),
      quantity: Number(formData.get('quantity')),
    });
    if (!result.ok) {
      setFormError(result.error || 'Resource could not be saved.');
    } else {
      form.reset();
    }
    setIsCreating(false);
  };

  const handleAssign = async (event) => {
    event.preventDefault();
    setFormError('');
    const form = event.currentTarget;
    const formData = new FormData(form);
    const incidentId = formData.get('incident_id');
    const result = await onAssignResource(incidentId, {
      resource_id: formData.get('resource_id'),
      quantity: Number(formData.get('quantity')),
    });
    if (!result.ok) {
      setFormError(result.error || 'Resource could not be assigned.');
    } else {
      form.reset();
    }
  };

  const availableResources = resources.filter(
    (resource) => Number(resource.available_quantity) > 0
  );
  const editable = Boolean(operator);

  return (
    <section className="rq-resource-panel rounded-2xl border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
            Emergency Resource Registry
          </h2>
          <p className="text-[11px] text-purple-200/65">
            Only persisted operator-entered resources are shown. No simulated availability.
          </p>
        </div>
        <span className="rounded-lg border border-purple-300/20 bg-[#2D1B4E] px-2.5 py-1 text-[10px] text-purple-100">
          {resources.length} registered
        </span>
      </div>

      {formError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {formError}
        </p>
      )}

      {editable ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={handleCreate} className="space-y-2 rounded-xl border border-purple-300/15 bg-[#2D1B4E]/35 p-3">
            <h3 className="text-xs font-semibold text-white">Add Resource</h3>
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Resource name or team"
              className="w-full rounded-lg border border-purple-300/20 bg-[#120721] px-3 py-2 text-xs text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <select name="type" className="rounded-lg border border-purple-300/20 bg-[#120721] px-2 py-2 text-xs text-white">
                {RESOURCE_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
              <input
                name="quantity"
                required
                type="number"
                min="1"
                max="10000"
                defaultValue="1"
                aria-label="Quantity"
                className="rounded-lg border border-purple-300/20 bg-[#120721] px-3 py-2 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isCreating || isSubmitting}
              className="rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {isCreating ? 'Saving...' : 'Add to Registry'}
            </button>
          </form>

          <form onSubmit={handleAssign} className="space-y-2 rounded-xl border border-purple-300/15 bg-[#2D1B4E]/35 p-3">
            <h3 className="text-xs font-semibold text-white">Assign to Incident</h3>
            <select
              name="incident_id"
              required
              value={assignmentIncidentId}
              onChange={(event) => setAssignmentIncidentId(event.target.value)}
              className="w-full rounded-lg border border-purple-300/20 bg-[#120721] px-2 py-2 text-xs text-white"
            >
              {incidents.map((incident) => (
                <option key={incident.incident_id} value={incident.incident_id}>
                  {incident.incident_id} · {incident.type} · {incident.place}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                name="resource_id"
                required
                disabled={!availableResources.length}
                className="rounded-lg border border-purple-300/20 bg-[#120721] px-2 py-2 text-xs text-white"
              >
                {availableResources.map((resource) => (
                  <option key={resource.resource_id} value={resource.resource_id}>
                    {resource.name} ({resource.available_quantity} available)
                  </option>
                ))}
              </select>
              <input
                name="quantity"
                required
                type="number"
                min="1"
                defaultValue="1"
                aria-label="Assignment quantity"
                className="rounded-lg border border-purple-300/20 bg-[#120721] px-3 py-2 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !availableResources.length || !incidents.length}
              className="rounded-lg border border-[#FF6B35]/50 bg-[#FF6B35]/15 px-3 py-2 text-xs font-semibold text-orange-100 disabled:opacity-50"
            >
              {isSubmitting ? 'Assigning...' : 'Assign Resource'}
            </button>
          </form>
        </div>
      ) : (
        <p className="mb-3 rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/80">
          Operator sign-in is required to add, update, or assign resources.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {resources.map((resource) => {
          const activeDeployments = (resource.deployments || []).filter(
            (deployment) => deployment.status !== 'Returned'
          );
          return (
            <article key={resource.resource_id} className="rounded-xl border border-purple-300/15 bg-[#2D1B4E]/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold text-white">{resource.name}</h3>
                    <span className="rounded border border-purple-300/20 px-1.5 py-0.5 text-[9px] text-purple-200">
                      {resource.type}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                      resource.status === 'Available'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : resource.status === 'Deployed'
                          ? 'bg-orange-500/15 text-orange-200'
                          : 'bg-slate-500/20 text-slate-200'
                    }`}>
                      {resource.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-purple-200/75">
                    Available {resource.available_quantity} · Deployed {resource.deployed_quantity} · Unavailable {resource.unavailable_quantity} · Total {resource.total_quantity}
                  </p>
                </div>
                {editable && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={isSubmitting || Number(resource.deployed_quantity) > 0}
                      onClick={() => onUpdateResource(resource.resource_id, {
                        action: resource.status === 'Unavailable' ? 'available' : 'unavailable',
                      })}
                      className="rounded-lg border border-purple-300/20 px-2 py-1 text-[10px] text-purple-100 disabled:opacity-50"
                    >
                      {resource.status === 'Unavailable' ? 'Mark available' : 'Mark unavailable'}
                    </button>
                    <details className="relative">
                      <summary className="cursor-pointer rounded-lg border border-purple-300/20 px-2 py-1 text-[10px] text-purple-100">
                        Edit
                      </summary>
                      <form
                        className="absolute right-0 z-20 mt-2 w-64 space-y-2 rounded-xl border border-purple-300/25 bg-[#120721] p-3 shadow-xl"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const formData = new FormData(form);
                          const result = await onUpdateResource(resource.resource_id, {
                            action: 'update',
                            name: formData.get('name'),
                            type: formData.get('type'),
                            quantity: Number(formData.get('quantity')),
                          });
                          if (result.ok) form.closest('details').open = false;
                          else setFormError(result.error || 'Resource could not be updated.');
                        }}
                      >
                        <input name="name" required maxLength={120} defaultValue={resource.name} className="w-full rounded-lg bg-[#2D1B4E] px-2 py-1.5 text-xs text-white" />
                        <select name="type" defaultValue={resource.type} className="w-full rounded-lg bg-[#2D1B4E] px-2 py-1.5 text-xs text-white">
                          {RESOURCE_TYPES.map((type) => <option key={type}>{type}</option>)}
                        </select>
                        <input name="quantity" type="number" min={Number(resource.deployed_quantity || 0) + Number(resource.unavailable_quantity || 0)} defaultValue={resource.total_quantity} className="w-full rounded-lg bg-[#2D1B4E] px-2 py-1.5 text-xs text-white" />
                        <button disabled={isSubmitting} className="rounded-lg bg-[#FF6B35] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                          Save changes
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>
              {activeDeployments.map((deployment) => (
                <div key={deployment.deployment_id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-purple-300/10 pt-2 text-[10px] text-purple-200/80">
                  <span>
                    {deployment.quantity} assigned to {deployment.incident_id} · {deployment.location || 'location unavailable'} · {deployment.assigned_at ? new Date(deployment.assigned_at).toLocaleString() : 'timestamp unavailable'}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onUpdateResource(resource.resource_id, {
                        action: 'return',
                        deployment_id: deployment.deployment_id,
                      })}
                      className="rounded border border-emerald-400/25 px-2 py-1 text-emerald-200 disabled:opacity-50"
                    >
                      Mark returned
                    </button>
                  )}
                </div>
              ))}
            </article>
          );
        })}
        {resources.length === 0 && (
          <p className="rounded-xl border border-purple-300/15 p-3 text-xs text-purple-200/65">
            No real resources have been registered in the backend.
          </p>
        )}
      </div>
    </section>
  );
}
